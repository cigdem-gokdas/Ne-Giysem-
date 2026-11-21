// Flat ESLint config extending the Expo preset.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // React Compiler advisory rules flag long-standing, working patterns (loading flags set at the start of
    // fetch effects, refs mirrored during render). Keep them visible as warnings instead of failing CI.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  { ignores: ['dist/*', 'node_modules/*', 'api-worker/**', '.expo/*', 'scripts/*'] },
]);
