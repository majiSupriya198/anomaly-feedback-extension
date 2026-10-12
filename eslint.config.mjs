import js from '@eslint/js';
import globals from 'globals';

const extensionGlobals = { ...globals.browser, ...globals.serviceworker, chrome: 'readonly', AFX: 'writable', importScripts: 'readonly', module: 'writable', require: 'readonly' };

export default [
  { ignores: ['node_modules/', 'site/', 'coverage/'] },
  js.configs.recommended,
  {
    // Extension code: classic scripts sharing the AFX global, some also loaded as CommonJS in tests.
    files: ['authz/**', 'feedback/**', 'storage/**', 'ui/**', 'content/**', 'background/**', 'admin/**', 'options/**', 'popup/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: extensionGlobals },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-eval': 'error', 'no-new-func': 'error', 'no-implied-eval': 'error' },
  },
  {
    files: ['server/**', 'scripts/**', '*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
  { files: ['server/**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  {
    files: ['tests/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser, chrome: 'writable' } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }], 'no-empty': 'off' },
  },
];
