import js from '@eslint/js';
import { configs as tsConfigs, parser } from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tsConfigs.recommended,
  {
    ignores: [
      '**/dist/**',
      'dist/',
      'node_modules/',
      '*.log',
      '**/generated/**',
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
      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];
