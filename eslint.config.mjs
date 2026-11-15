// Lint for every TypeScript package. Rules here encode decisions an AI tends to
// forget; each message says what to do instead. Formatting is Prettier's job.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MAX_FILE_LINES = 400;
const MAX_FUNCTION_LINES = 150;

/**
 * Files already over the size limits when the rule was added. Each is to be split;
 * remove an entry once its file fits. Do not add new entries.
 */
const OVERSIZED_FILES = [
  'packages/shared/src/ai-client.ts',
  'apps/web/src/shell/landing/Landing.tsx',
  'apps/web/src/core/Studio.tsx',
  'apps/web/src/core/canvas/useCanvas.ts',
  'apps/web/src/core/generation/useGeneration.ts',
];
/** Components and hooks whose main function is over the limit. Same rule: split, then remove. */
const OVERSIZED_FUNCTIONS = [
  ...OVERSIZED_FILES,
  'apps/web/src/shell/settings/APISettings.tsx',
  'apps/web/src/core/film/ExportDialog.tsx',
  'apps/web/src/core/film/PreviewDialog.tsx',
  'apps/web/src/ui/Select.tsx',
  'apps/web/src/core/film/Sequence.tsx',
  'apps/web/src/core/generation/WorkflowPanel.tsx',
  'apps/web/src/shell/landing/useLandingMotion.ts',
  'apps/web/src/core/generation/useWorkflow.ts',
  'apps/web/src/core/project/useWorkspace.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/release/**',
      '**/.turbo/**',
      '**/.dev-data/**',
      '**/coverage/**',
      'apps/api/**',
      'reference/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'one-var': ['error', { initialized: 'never', uninitialized: 'never' }],
      'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx,js}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='frameoutDesktop']",
          message:
            '桌面接口只在 lib/platform.ts 里读取，其他地方用 desktopBridge() 或 isDesktop()。',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/platform.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: [
      'apps/server/**/*.ts',
      'apps/desktop/**/*.ts',
      'packages/**/*.{ts,js}',
      'tools/**/*.mts',
      '**/vite.config.ts',
      '*.mjs',
      'apps/web/scripts/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests read best as one long list of cases, stub the desktop bridge, and read untyped JSON.
    files: ['**/*.test.{ts,tsx,js}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  { files: OVERSIZED_FILES, rules: { 'max-lines': 'off' } },
  { files: OVERSIZED_FUNCTIONS, rules: { 'max-lines-per-function': 'off' } },
);
