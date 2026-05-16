import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import pluginImport from 'eslint-plugin-import';
import pluginJsxA11y from 'eslint-plugin-jsx-a11y';
import prettierPlugin from 'eslint-plugin-prettier';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**/*', 'dist/**/*', 'build/**/*', 'coverage/**/*', '*.min.js'],
  },

  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      'jsx-a11y': pluginJsxA11y,
      import: pluginImport,
      prettier: prettierPlugin,
    },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx'],
          moduleDirectory: ['node_modules', 'src/'],
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...pluginReact.configs.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      ...pluginJsxA11y.configs.recommended.rules,
      ...pluginImport.configs.recommended.rules,
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

      'no-alert': 'warn',
      'no-console': 'off',

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

      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'error',
      'react/display-name': 'error',
      'react/no-unused-prop-types': 'error',
      'react/no-unused-state': 'error',
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-pascal-case': 'error',
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      'react/no-array-index-key': 'error',
      'react/no-danger': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-string-refs': 'error',
      'react/no-unknown-property': 'error',
      'react/prefer-es6-class': 'error',
      'react/require-render-return': 'error',
      'react/function-component-definition': [
        'error',
        {
          namedComponents: 'arrow-function',
          unnamedComponents: 'arrow-function',
        },
      ],
      'react/no-unstable-nested-components': 'error',
      'react/jsx-fragments': ['error', 'syntax'],
      'react/jsx-no-leaked-render': ['error', { validStrategies: ['ternary'] }],
      'react/jsx-no-useless-fragment': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/first': 'error',
      'import/no-amd': 'error',
      'import/no-webpack-loader-syntax': 'error',
      'import/no-unresolved': ['error', { commonjs: true }],
      'import/named': 'error',
      'import/default': 'error',
      'import/namespace': 'error',
      'import/no-absolute-path': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-self-import': 'error',
      'import/no-cycle': ['error', { maxDepth: 10 }],
      'import/no-useless-path-segments': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      'import/no-deprecated': 'error',
      'import/no-empty-named-blocks': 'error',
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.{js,jsx}',
            '**/*.spec.{js,jsx}',
            '**/*.config.{js,mjs}',
            '**/vite.config.{js,mjs}',
            '**/vitest.config.{js,mjs}',
          ],
        },
      ],

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
            {
              name: 'axios',
              message: 'Use the bundled fetch wrapper in src/api/client.js instead of axios.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/vite.config.{js,mjs}', '**/vitest.config.{js,mjs}'],
    rules: {
      'no-undef': 'off',
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  },

  {
    files: [
      '**/*.test.{js,jsx}',
      '**/*.spec.{js,jsx}',
      '**/test/**/*.{js,jsx}',
      '**/tests/**/*.{js,jsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-expressions': 'off',
      complexity: 'off',
      'prefer-arrow-callback': 'off',
      'func-style': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
    },
  },
];
