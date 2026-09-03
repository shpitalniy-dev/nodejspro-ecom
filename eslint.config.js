import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import { configs as tsconfigs } from 'typescript-eslint';

const OFF = 0;
const WARN = 1;
const ERROR = 2;

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tsconfigs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    ignores: ['node_modules', 'dist', 'build', '.test-build', '.turbo'],
  },
  {
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['tsconfig.json'],
        },
      },
    },
  },
  {
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': ERROR,
    },
  },
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        exports: 'writable',
        fetch: 'readonly',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      // Code style
      'arrow-body-style': [ERROR, 'as-needed'],
      'arrow-parens': [WARN, 'as-needed'],
      'block-spacing': ERROR,
      'brace-style': ERROR,
      'comma-dangle': [ERROR, 'always-multiline'],
      'comma-spacing': ERROR,
      'computed-property-spacing': ERROR,
      curly: [ERROR, 'multi-line'],
      'key-spacing': ERROR,
      'eol-last': ERROR,
      quotes: [ERROR, 'single', { allowTemplateLiterals: true }],
      'object-curly-spacing': [ERROR, 'always'],
      'space-before-function-paren': [
        ERROR,
        { anonymous: 'always', named: 'never', asyncArrow: 'always' },
      ],
      'no-trailing-spaces': WARN,
      'no-debugger': WARN,
      'no-console': OFF,
      'no-var': ERROR,
      'no-process-exit': OFF,
      'no-path-concat': ERROR,
      'no-sync': WARN,
      'handle-callback-err': OFF,
      'padding-line-between-statements': [
        ERROR,
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: 'block' },
        { blankLine: 'always', prev: 'block', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],

      // Import sorting & cleanup
      'import/export': ERROR,
      'import/order': OFF, // handled by simple-import-sort
      'import/no-unresolved': OFF, // handled by TypeScript
      'import/newline-after-import': ERROR,
      'import/no-cycle': ERROR,
      'import/no-duplicates': ERROR,
      'sort-imports': OFF,
      'simple-import-sort/imports': [
        ERROR,
        {
          groups: [
            ['reflect-metadata'],
            [
              '^(assert|buffer|child_process|crypto|dns|events|fs|http|https|os|path|stream|url|util|zlib)(/.*|$)',
            ],
            ['^react', '^(?!@/)@?\\w'],
            ['^@/', '^(utils|config|hooks|components|lib|api)(/.*|$)'],
            ['^\\u0000'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            ['^.+\\.s?css$'],
          ],
        },
      ],
      'simple-import-sort/exports': WARN,

      // Remove unused imports/vars automatically
      'unused-imports/no-unused-imports': ERROR,
      'unused-imports/no-unused-vars': [
        ERROR,
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      // Best practices
      'no-return-await': WARN,
      'prefer-object-spread': WARN,

      // TypeScript-specific rules
      '@typescript-eslint/ban-types': OFF,
      '@typescript-eslint/explicit-function-return-type': OFF,
      '@typescript-eslint/explicit-module-boundary-types': OFF,
      '@typescript-eslint/no-explicit-any': WARN,
      '@typescript-eslint/no-non-null-assertion': ERROR,
      '@typescript-eslint/no-unused-vars': [
        ERROR,
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-use-before-define': OFF,
      '@typescript-eslint/triple-slash-reference': OFF,
      '@typescript-eslint/consistent-type-imports': OFF,
      '@typescript-eslint/no-var-requires': WARN,
      '@typescript-eslint/no-require-imports': OFF,

      'no-dupe-class-members': OFF,
      'no-unused-vars': OFF,
    },
  },
  eslintConfigPrettier, // always last
];
