import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'performance-results/**',
    ],
  },
  js.configs.recommended,
  { files: ['verification/*.mjs'], languageOptions: { globals: { console: 'readonly' } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript', 'jsx'] },
        },
      },
    },
    rules: {
      // TypeScript 7 checks names/unused declarations; typescript-eslint currently
      // excludes that compiler. Keep ESLint syntax-only without downgrading tsc.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAnyKeyword',
          message: 'Use an explicit domain type or unknown instead of any.',
        },
      ],
    },
  },
  {
    files: ['verification/phone-check.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        requestAnimationFrame: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        innerWidth: 'readonly',
        innerHeight: 'readonly',
      },
    },
  },
]);
