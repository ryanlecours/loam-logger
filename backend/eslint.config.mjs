import js from '@eslint/js';
import { configs as tsConfigs, parser } from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tsConfigs.recommended,
  {
    ignores: [
      'dist/',
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
      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];
