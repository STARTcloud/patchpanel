import js from '@eslint/js';
import globals from 'globals';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

// Root-level flat config. Lints ONLY packaging/scripts/**.
// The server/ and web/ workspaces have their own eslint.config.mjs.

export default [
  {
    ignores: [
      'server/**/*',
      'web/**/*',
      'node_modules/**/*',
      'coverage/**/*',
      '*.min.js',
      'logs/**/*',
      '**/*.log',
      'docs/api/swagger-ui.html',
      'docs/api/openapi.json',
    ],
  },

  {
    files: ['packaging/scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',

      // Variables / declarations
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'all',
          caughtErrors: 'all',
          ignoreRestSiblings: false,
          reportUsedIgnorePattern: false,
        },
      ],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'no-shadow': 'error',
      'no-shadow-restricted-names': 'error',
      'no-redeclare': 'error',

      // Functions
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      'no-loop-func': 'error',
      'no-new-func': 'error',
      'default-param-last': 'error',
      'no-param-reassign': ['error', { props: false }],

      // Objects / arrays
      'object-shorthand': ['error', 'always'],
      'prefer-destructuring': ['error', { array: true, object: true }],
      'no-array-constructor': 'error',
      'array-callback-return': ['error', { allowImplicit: true }],
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',

      // Strings / templates
      'prefer-template': 'error',
      'no-useless-escape': 'error',
      'no-useless-concat': 'error',

      // Comparison
      eqeqeq: ['error', 'always'],
      'no-nested-ternary': 'warn',
      'no-unneeded-ternary': 'error',
      'no-else-return': 'error',
      'consistent-return': 'error',

      // Error handling
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'error',

      // Async / await
      'require-await': 'error',
      'no-await-in-loop': 'warn',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',

      // Modules
      'no-duplicate-imports': 'error',
      'no-useless-rename': 'error',

      // Security / best practices
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',
      'no-caller': 'error',
      'no-iterator': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-global-assign': 'error',

      // Node specific
      'no-process-exit': 'error',
      'no-process-env': 'off',
      'no-console': 'off',

      // Code quality
      complexity: ['warn', 30],
      'max-depth': ['warn', 6],
      'max-params': ['warn', 8],

      // Naming
      camelcase: 'off',
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],

      // Performance
      'no-lonely-if': 'error',
      'no-useless-call': 'error',
      'no-useless-return': 'error',
      'no-useless-constructor': 'error',

      // Modern JavaScript
      'prefer-object-spread': 'error',
      'prefer-exponentiation-operator': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-object-has-own': 'error',

      // Style
      curly: ['error', 'all'],
      'dot-notation': 'error',
      'no-multi-assign': 'error',
      'one-var': ['error', 'never'],

      // Regex
      'prefer-named-capture-group': 'warn',
      'prefer-regex-literals': 'error',
      'no-useless-backreference': 'error',

      // Imports
      'no-restricted-imports': [
        'error',
        {
          patterns: ['../**/node_modules/**'],
        },
      ],

      // Debugging
      'no-debugger': 'warn',
      'no-alert': 'error',

      // Unicode
      'unicode-bom': ['error', 'never'],
      'no-irregular-whitespace': 'error',
    },
  },
];
