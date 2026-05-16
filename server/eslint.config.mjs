import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**/*', 'coverage/**/*', '*.min.js', '**/*.log', 'dist/**/*'],
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
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

      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      'no-loop-func': 'error',
      'no-new-func': 'error',
      'default-param-last': 'error',
      'no-param-reassign': ['error', { props: false }],

      'object-shorthand': ['error', 'always'],
      'prefer-destructuring': ['error', { array: true, object: true }],
      'no-array-constructor': 'error',
      'array-callback-return': ['error', { allowImplicit: true }],
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',

      'prefer-template': 'error',
      'no-useless-escape': 'error',
      'no-useless-concat': 'error',

      eqeqeq: ['error', 'always'],
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'no-else-return': 'error',
      'consistent-return': 'error',

      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'error',

      'require-await': 'error',
      'no-await-in-loop': 'error',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',

      'no-duplicate-imports': 'error',
      'no-useless-rename': 'error',

      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',
      'no-caller': 'error',
      'no-iterator': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-global-assign': 'error',

      'no-restricted-globals': ['error', 'event', 'fdescribe'],
      'no-restricted-syntax': ['error', 'WithStatement'],
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-void': 'error',
      'no-constant-binary-expression': 'error',
      'no-constructor-return': 'error',
      'no-new-native-nonconstructor': 'error',
      'no-object-constructor': 'error',

      'no-unreachable-loop': 'error',
      'logical-assignment-operators': 'error',
      'grouped-accessor-pairs': 'error',

      'no-process-exit': 'error',
      'no-process-env': 'off',
      'no-console': 'warn',

      complexity: ['error', 20],
      'max-depth': ['error', 4],
      'max-params': ['error', 6],

      camelcase: 'off',
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],

      'no-lonely-if': 'error',
      'no-useless-call': 'error',
      'no-useless-return': 'error',
      'no-useless-constructor': 'error',

      'prefer-object-spread': 'error',
      'prefer-exponentiation-operator': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-object-has-own': 'error',

      curly: ['error', 'all'],
      'dot-notation': 'error',
      'no-multi-assign': 'error',
      'one-var': ['error', 'never'],

      'prefer-named-capture-group': 'error',
      'prefer-regex-literals': 'error',
      'no-useless-backreference': 'error',

      'unicode-bom': ['error', 'never'],
      'no-irregular-whitespace': 'error',

      'no-debugger': 'error',
      'no-alert': 'error',

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../**/node_modules/**'],
              message: 'Do not import from nested node_modules directories.',
            },
          ],
          paths: [
            {
              name: 'lodash',
              message: 'Please use lodash-es or import individual functions instead.',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      '**/*.test.{js,mjs}',
      '**/*.spec.{js,mjs}',
      '**/test/**/*.{js,mjs}',
      '**/tests/**/*.{js,mjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-expressions': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'prefer-arrow-callback': 'off',
      'func-style': 'off',
    },
  },

  // Config bootstrap runs before logger.js is wired (it reads the very
  // config that configures the logger), so console.* is correct here.
  {
    files: ['src/config/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
];
