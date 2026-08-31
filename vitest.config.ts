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
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
  },
});
