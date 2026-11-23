import { isTerminalBuildStatus } from '@aab/shared-types';
import { Controller, Get, Logger, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators';
import type { AppRequest, AuthUser } from '../../common/http/request';
import { RawResponse } from '../../common/http/response-envelope.interceptor';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { toEventDto } from './builds.service';
import { StreamLimiter } from './stream-limiter';

const ACTIVE_POLL_MS = 500;
const IDLE_POLL_MAX_MS = 3000;
const HEARTBEAT_MS = 15_000;
const ACCESS_RECHECK_MS = 60_000;
const MAX_STREAM_MS = 10 * 60_000;
const BATCH = 200;

const cursorSchema = z.coerce.number().int().min(0).max(2_147_483_647).catch(0);

/** Single-valued header/query value (arrays and garbage fall back to 0). */
function parseCursor(req: AppRequest): number {
  const header = req.get('last-event-id');
  const query = req.query.afterSequence;
  return cursorSchema.parse(header ?? (typeof query === 'string' ? query : undefined) ?? 0);
}

/**
 * Server-Sent Events for build progress. PostgreSQL is the source of truth, so
 * the stream tails build_job_events by sequence (resumable with Last-Event-ID)
 * and works across API instances without extra pub/sub infrastructure.
 *
 * Cost controls: concurrent streams are capped per user and per instance,
 * polling backs off while a build is idle, and the stream has a bounded
 * lifetime. Authorization runs at connect (global AuthGuard + ownership) and
 * is re-checked periodically so revoked access ends the stream.
 */
@ApiTags('builds')
@ApiBearerAuth()
@Controller('builds')
export class BuildStreamController {
  private readonly logger = new Logger(BuildStreamController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly limiter: StreamLimiter,
  ) {}

  @Get(':buildId/stream')
  @RawResponse()
  @ApiProduces('text/event-stream')
  @ApiOperation({ summary: 'Live build progress (SSE): build-event, status and end events' })
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    // All stream state is declared up front and disconnect handling is
    // registered before any await, so an early client abort is never missed.
    let closed = false;
    let disconnected = false;
    let release: () => void = () => undefined;
    let pollTimer: NodeJS.Timeout | undefined;
    const timers: { heartbeat?: NodeJS.Timeout; lifetime?: NodeJS.Timeout } = {};
    let cursor = parseCursor(req);
    let idleDelay = ACTIVE_POLL_MS;
    let lastAccessCheck = Date.now();

    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(pollTimer);
      clearInterval(timers.heartbeat);
      clearTimeout(timers.lifetime);
      release();
      if (!res.writableEnded) res.end();
    };
    req.on('close', () => {
      disconnected = true;
      close();
    });

    await this.access.assertBuildAccess(user.id, buildId);
    release = this.limiter.acquire(user.id);
    if (disconnected || closed) {
      release();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    const send = (event: string, data: unknown, id?: number) => {
      if (closed) return;
      res.write(
        `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    };

    const poll = async (): Promise<void> => {
      if (closed) return;
      try {
        if (Date.now() - lastAccessCheck > ACCESS_RECHECK_MS) {
          lastAccessCheck = Date.now();
          await this.access.assertBuildAccess(user.id, buildId);
        }
        // Read status first, then events: the terminal status and its final
        // event commit together, so events read afterwards include it.
        const build = await this.prisma.client.buildJob.findUnique({
          where: { id: buildId },
          select: {
            status: true,
            currentStep: true,
            attempt: true,
            repairAttempts: true,
            errorCode: true,
            errorMessage: true,
            cancelRequestedAt: true,
          },
        });
        if (!build) return close();
        const events = await this.prisma.client.buildJobEvent.findMany({
          where: { buildJobId: buildId, sequence: { gt: cursor } },
          orderBy: { sequence: 'asc' },
          take: BATCH,
        });
        for (const event of events) {
          send('build-event', toEventDto(event), event.sequence);
          cursor = event.sequence;
        }
        if (events.length > 0 || cursor === 0) {
          send('status', {
            status: build.status,
            currentStep: build.currentStep,
            attempt: build.attempt,
            repairAttempts: build.repairAttempts,
            cancelRequested: build.cancelRequestedAt !== null,
            error: build.errorCode ? { code: build.errorCode, message: build.errorMessage } : null,
          });
        }
        if (isTerminalBuildStatus(build.status) && events.length < BATCH) {
          send('end', { status: build.status });
          return close();
        }
        // Poll fast while events flow; back off while the build is idle.
        idleDelay = events.length > 0 ? ACTIVE_POLL_MS : Math.min(idleDelay * 2, IDLE_POLL_MAX_MS);
      } catch (error) {
        if (error instanceof Error && error.name === 'NotFoundError') return close();
        this.logger.warn({ err: error, buildId }, 'build stream poll failed');
        idleDelay = IDLE_POLL_MAX_MS;
      }
      if (!closed) pollTimer = setTimeout(() => void poll(), idleDelay);
    };

    timers.heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), HEARTBEAT_MS);
    // Bounded lifetime; EventSource reconnects automatically with Last-Event-ID.
    timers.lifetime = setTimeout(close, MAX_STREAM_MS);
    await poll();
  }
}
