const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierConfig = require('eslint-config-prettier');
const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'test/**', '*.config.js', '*.cjs', 'packages/*/dist/**', 'packages/*/dist-esm/**', 'packages/*/dist-test/**'],
  },
  {
    // packages/core/src is published to npm: it gets the same rules as the extension.
    files: ['src/**/*.ts', 'packages/core/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  prettierConfig,
  // Test files legitimately use require()-style imports: they hijack the
  // module cache (new Module + _compile) to stub 'vscode' and lazily load
  // compiled output, which cannot be expressed as static ESM imports.
  {
    files: ['src/test/**/*.ts', 'src/test-e2e/**/*.ts', 'src/test-visual/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Plain-JS tooling and the diff webview: not type-checked by tsc, so lint is
  // the only static check they get.
  {
    files: ['scripts/**/*.cjs', 'scripts/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly',
        __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly', URL: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['media/diff-webview.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly', acquireVsCodeApi: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', ResizeObserver: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', getComputedStyle: 'readonly', CSS: 'readonly',
        Node: 'readonly', Element: 'readonly', HTMLElement: 'readonly', MutationObserver: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
];
