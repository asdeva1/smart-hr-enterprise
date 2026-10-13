import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        plugins,
        test: { name: 'integration', include: ['test/**/*.int.test.ts'], testTimeout: 20_000 },
      },
    ],
  },
});
