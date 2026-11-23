import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export interface CreatePrismaClientOptions {
  databaseUrl: string;
  /** Upper bound on pooled connections for this process. */
  maxConnections?: number;
}

/** Create a Prisma client bound to PostgreSQL through the `pg` driver adapter. */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 10,
  });
  return new PrismaClient({ adapter });
}
