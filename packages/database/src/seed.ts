/**
 * Development seed. Creates a demo user and an example project.
 *
 * Allow-listed environments only (development, test): development credentials
 * must never exist in production, staging, or any unlabeled environment.
 */
import { loadWorkspaceDotenv } from '@aab/shared-config';
import { hash } from 'argon2';
import { createPrismaClient } from './client';

export const DEV_SEED_EMAIL = 'dev@example.com';

async function main(): Promise<void> {
  loadWorkspaceDotenv();
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(
      `Refusing to seed development data: NODE_ENV must be "development" or "test" (got "${nodeEnv ?? 'unset'}")`,
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed');
  const password = process.env.DEV_SEED_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('DEV_SEED_PASSWORD (min 12 chars) is required to seed the dev user');
  }

  const prisma = createPrismaClient({ databaseUrl, maxConnections: 1 });
  try {
    const user = await prisma.user.upsert({
      where: { email: DEV_SEED_EMAIL },
      update: {},
      create: {
        email: DEV_SEED_EMAIL,
        displayName: 'Dev User',
        passwordHash: await hash(password),
      },
    });

    const existing = await prisma.project.findFirst({
      where: { ownerId: user.id, name: 'Sample Todo App' },
    });
    if (!existing) {
      await prisma.project.create({
        data: {
          ownerId: user.id,
          name: 'Sample Todo App',
          description: 'Seeded example project (development only)',
        },
      });
    }
    process.stdout.write(`Seeded dev user ${DEV_SEED_EMAIL}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
