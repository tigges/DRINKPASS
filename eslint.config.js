import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', '.lighthouseci/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-else-if': 'error',
      'no-unreachable': 'error',
      eqeqeq: ['error', 'smart']
    }
  },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
  { files: ['scripts/**', 'tests/**', '*.config.js', 'lighthouserc.cjs'], languageOptions: { globals: { ...globals.node } } },
  { files: ['lighthouserc.cjs'], languageOptions: { sourceType: 'commonjs' } }
];
