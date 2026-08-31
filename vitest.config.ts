import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@pinout/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@pinout/core/serial': fileURLToPath(
        new URL('./packages/core/src/serial.ts', import.meta.url),
      ),
      '@pinout/cli/connection': fileURLToPath(
        new URL('./packages/cli/src/connectionArgs.ts', import.meta.url),
      ),
      '@pinout/cli/script': fileURLToPath(
        new URL('./packages/cli/src/runScript.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
