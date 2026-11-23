import type { Logger } from 'pino';

export type MetricLabels = Record<string, string | number | boolean>;

/**
 * Minimal telemetry interface. Implementations can forward to Prometheus,
 * OpenTelemetry, StatsD, etc. without touching call sites.
 *
 * Metric names used today:
 *  - build_job_duration_ms (histogram)   build_job_outcome_total (counter)
 *  - build_job_retry_total (counter)     build_queue_wait_ms (histogram)
 *  - worker_active_jobs (gauge-like observation)
 *  - llm_tokens_total (counter)          llm_request_cost_usd (counter)
 *  - llm_request_latency_ms (histogram)
 */
export interface Metrics {
  increment(name: string, value?: number, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
}

/** Emits each metric as a structured log line (`msg: "metric"`). */
export class LogMetrics implements Metrics {
  constructor(private readonly logger: Logger) {}

  increment(name: string, value = 1, labels: MetricLabels = {}): void {
    this.logger.info({ metric: name, kind: 'counter', value, labels }, 'metric');
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    this.logger.info({ metric: name, kind: 'observation', value, labels }, 'metric');
  }
}

/** Discards metrics (tests, or when telemetry is disabled). */
export class NoopMetrics implements Metrics {
  increment(): void {}
  observe(): void {}
}
