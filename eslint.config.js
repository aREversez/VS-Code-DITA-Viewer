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
  // @dita-viewer/core must run where there is no Node: outside src/node/, no Node
  // built-in, no Buffer, no process. File access goes through the runtime's
  // FileSystem (src/runtime/fs.ts) and paths through its PathOps
  // (src/runtime/path.ts); see packages/core/DESIGN.md 3.1, goal G1.
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/node/**'],
    rules: {
      // Core reports through the host's onWarning sink (packages/core/src/warnings.ts), never the console.
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'path', 'os', 'url', 'child_process', 'crypto', 'stream', 'util', 'vm', 'zlib', 'http', 'https', 'net', 'worker_threads', 'module', 'buffer', 'process', 'events', 'readline', 'assert'].map((name) => ({
            name,
            message: 'core must not import Node built-ins outside src/node/; use runtime/fs or runtime/path.',
          })),
          patterns: [{ group: ['node:*', 'fs/*', 'path/*'], message: 'core must not import Node built-ins outside src/node/.' }],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Buffer', message: 'No Buffer in core: use Uint8Array and DataView (src/utf8.ts has the helpers).' },
        { name: 'process', message: 'No process in core: ask the platform (PathOps.caseSensitive, ...).' },
        { name: '__dirname', message: 'No Node globals in core.' },
        { name: '__filename', message: 'No Node globals in core.' },
        { name: 'require', message: 'No require in core.' },
      ],
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
