// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/src/generated/**',
      '**/next-env.d.ts',
      '**/*.config.{js,mjs,cjs,ts}',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      // Nest DI needs runtime class references for constructor parameters; type-only imports would break injection.
      '@typescript-eslint/no-extraneous-class': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Nest modules: constructor-injected classes must stay value imports so decorator metadata can reference them.
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router only: there is no pages/ directory for this rule to check.
      '@next/next/no-html-link-for-pages': 'off',
      // React accepts async event handlers (react-hook-form's handleSubmit returns a promise);
      // still flag promises passed anywhere else a void callback is expected.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
    settings: { next: { rootDir: `${import.meta.dirname}/apps/web` } },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
