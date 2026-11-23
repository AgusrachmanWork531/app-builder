import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (DI) is emitted under Vitest.
export const swcPlugin = swc.vite({
  jsc: {
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: 'es2023',
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
