import { loadWorkspaceDotenv } from '@aab/shared-config';
import { defineConfig } from 'prisma/config';

loadWorkspaceDotenv(__dirname);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/seed.js',
  },
  // Optional so `prisma generate` works without a database (CI, fresh clone);
  // migrate/seed commands fail clearly when DATABASE_URL is missing.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
