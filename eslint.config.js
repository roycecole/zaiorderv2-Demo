import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/** 分層依賴規則（07 §4）：以 no-restricted-imports 強制 */
const layer = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
});

const REACT = ['react', 'react-dom', 'react-dom/*', 'react-router', 'react-router/*'];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'docs', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 時間一律經 getClock()（07 §6.4）；單調計時用 performance.now()
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: '請使用 getClock().now()（鍵盤提醒用 systemClock.now()）' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '請使用 getClock().now()，不要 new Date()',
        },
      ],
    },
  },
  // domain：純 TypeScript，無 React、無 I/O
  {
    files: ['src/domain/**/*.ts'],
    rules: layer(
      [...REACT, '@/services/*', '@/features/*', '@/components/*', '@/app/*', 'zustand', 'zustand/*', '@tanstack/*'],
      'domain 為純函式層，不得依賴 React、services、features、components（07 §4）',
    ),
  },
  // services：只可依賴 domain
  {
    files: ['src/services/**/*.{ts,tsx}'],
    rules: layer([...REACT, '@/features/*', '@/components/*', '@/app/*'], 'services 不得依賴 React、features、components（07 §4）'),
  },
  // components：只可依賴 domain
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: layer(['@/services/*', '@/features/*', '@/app/*'], 'components 只可依賴 domain（07 §4）'),
  },
  // features：不得直接碰 Mock / HTTP Adapter 內部
  {
    files: ['src/features/**/*.{ts,tsx}'],
    ignores: ['src/features/demo/**'],
    rules: layer(
      ['@/services/api/mock/*', '@/services/api/http/*'],
      'features 只能依賴 ApiClient 介面；Mock / HTTP 內部僅 features/demo 可經 DemoControl 存取（07 §4）',
    ),
  },
  // 時鐘模組與測試可使用 Date.now / new Date
  {
    files: ['src/services/clock.ts', 'src/**/*.test.{ts,tsx}', 'src/test/**', 'e2e/**', 'vite.config.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
  },
  { files: ['*.config.{js,ts}', 'scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
);
