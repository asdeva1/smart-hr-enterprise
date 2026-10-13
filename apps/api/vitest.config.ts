import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which Nest's dependency injection needs at runtime.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
