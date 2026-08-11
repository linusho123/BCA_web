import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.vitest-attachments'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The four that earn their runtime cost in this stack (see docs/10).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // Enforce the one-way dependency direction: ui → state → data → domain → schemas.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['~/ui/*'], message: 'domain/data/state must not import from ui/' },
        ],
      }],

      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },

  // Domain and schema layers are pure: they may not reach outward at all.
  {
    files: ['src/domain/**/*.ts', 'src/schemas/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['~/ui/*', '~/data/*', '~/state/*'],
            message: 'domain/ and schemas/ must stay pure — no imports from ui, data, or state' },
        ],
      }],
    },
  },

  // Plain .js files (this config included) are outside the TS project, so type-aware rules
  // cannot run on them. Without this block ESLint errors with "not found by the project service".
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Step definitions receive an untyped world; relax the strictest rules there.
  {
    files: ['features/**/*.ts', 'features/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  // The two browser features assert what a rendered page does, so their steps mount it. The
  // layering rule above is about the app's own dependency graph — a test that may not import the
  // thing it tests would only push the import somewhere less obvious.
  {
    files: ['features/steps/ui/**/*.ts', 'features/steps/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)
