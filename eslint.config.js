// ESLint 10 flat config: typescript-eslint recommended plus a few stricter rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'tools/verapdf/**', 'scripts/smoke/types-check.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build and smoke-test scripts (Node, ESM): e.g. scripts/compile-sef.mjs
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', performance: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // `scripts/**/*.ts`: CLI scripts report progress on stdout.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
