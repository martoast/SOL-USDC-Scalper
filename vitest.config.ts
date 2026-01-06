import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/indicators/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '~': new URL('./', import.meta.url).pathname,
    },
  },
});
