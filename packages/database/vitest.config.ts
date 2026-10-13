import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          // Integration tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
