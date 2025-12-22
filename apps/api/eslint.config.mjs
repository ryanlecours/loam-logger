import js from '@eslint/js';
import { configs as tsConfigs, parser } from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tsConfigs.recommended,
  {
    ignores: [
      '**/dist/**',
      'dist/',
      '**/server.cjs',
      'node_modules/',
      '.env',
      '*.log',
      '**/generated/**',
      '**/@prisma/client/'
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      semi: ["error", "always"],
      "semi-spacing": ["error", { before: false, after: true }],
      "semi-style": ["error", "last"],
    },
  },
];
