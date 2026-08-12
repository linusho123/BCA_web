import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { quickpickle } from 'quickpickle'
import { playwright } from '@vitest/browser-playwright'

/**
 * The features whose subject is a rendered page rather than a calculation.
 *
 * Listed in one place because two projects need it and they must not disagree: the node
 * project excludes exactly what the browser project includes, or a scenario runs twice
 * against two different step sets, or silently against neither.
 */
const UI_FEATURES = [
  'features/analysis/analysis-workflow.feature',
  'features/analysis/session-continuity.feature',
  'features/analysis/settings-persistence.feature',
  'features/analysis/curve-plot-presentation.feature',
  'features/analysis/curve-plot-crowding.feature',
  'features/analysis/plate-grid.feature',
  'features/analysis/plate-layout-painting.feature',
  'features/analysis/plate-paint-drag.feature',
  'features/analysis/plate-grid-from-file.feature',
  'features/analysis/standards-direction.feature',
] as const

export default defineConfig({
  /**
   * Assets are referenced relatively, so the built site runs from any path.
   *
   * The default is `/`, which emits `/assets/index-xxxx.js` and works only when the site is at
   * the root of a domain. A GitHub Pages project site is not: it is served from
   * `user.github.io/BCA_web/`, where an absolute asset path resolves to the wrong origin
   * entirely and the page loads blank with no error worth reading.
   *
   * Relative works here because routing is by hash — `#/analysis` never leaves index.html — so
   * there are no deep URLs for a static host to rewrite. An app with real paths would need the
   * base to name the sub-path instead, and the host to fall back to index.html.
   */
  base: './',

  /**
   * `stepTimeout` is raised from QuickPickle's 3s default because one step legitimately needs
   * most of it.
   *
   * Two scenarios claim that every plotted point is reachable *in the tab order*, which can only
   * be shown by tabbing — `.focus()` succeeds on elements a keyboard user can never reach. So
   * they press Tab once per focusable element on the page. That cost was fine when the page held
   * a dozen controls. It is not fine now: the 96-well grid made 96 of the page's 107 focusable
   * elements, and at ~18ms per Tab through the browser the step needs ~1.9s of honest work
   * against a 3s cap.
   *
   * 1.6x headroom is not headroom. Under `npm run verify`, where two Chromium projects run at
   * once, those two steps time out in roughly one run in three — which is the flake recorded in
   * features/README.md, and it is a property of the harness rather than of the app.
   *
   * Raised to 15s rather than made proportional: a timeout exists to catch a step that has hung,
   * and 15s still catches one. The number to watch is the ratio, and it is now about 8x.
   */
  plugins: [preact(), tailwindcss(), quickpickle({ stepTimeout: 15_000 })],

  resolve: {
    alias: { '~': new URL('./src', import.meta.url).pathname },
  },

  /**
   * Pre-bundled up front rather than on discovery.
   *
   * Vite optimizes a dependency the first time it is imported, and in browser mode that
   * happens mid-run: the page reloads, and a component that imported `preact/hooks` before
   * the reload holds hooks from one prebundle while `preact` came from another. Two Preact
   * instances share no hook state, and every render throws reading it.
   *
   * Listing them here means they are bundled before the first test loads, so there is no
   * reload to be caught by.
   */
  optimizeDeps: {
    include: [
      'preact',
      'preact/hooks',
      'preact/jsx-runtime',
      '@preact/signals',
      // lucide-preact calls useContext, so it is one of the dependencies that has to be bundled
      // in the same pass as preact/hooks. It was missing from this list for as long as the list
      // existed: the icons only reach a test through App, and until the persistence work every
      // browser step file mounted AnalysisPage directly, so nothing imported it early enough to
      // trigger the reload. See features/README.md on the once-observed acceptance:ui flake.
      'lucide-preact',
      'echarts/core',
      'echarts/charts',
      'echarts/components',
      'echarts/renderers',
    ],
  },

  test: {
    // Vitest 4: `projects` replaces the removed vitest.workspace.ts.
    // `extends: true` makes each project inherit the plugins and aliases above —
    // without it, feature files will not resolve `~` and JSX will not transform.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/ui/setup.browser.ts'],
          browser: {
            enabled: true,
            // Vitest 4: the provider is a function from @vitest/browser-playwright,
            // not the string 'playwright'.
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      // The acceptance layer is split by what a scenario needs, not by what it is about.
      //
      // Almost every feature here is a claim about the assay — an arithmetic, a guard, an
      // issue — and is proven against the domain in node, where a file runs in milliseconds.
      // Three are claims about a rendered page: that focus reaches what hover reaches, that a
      // failed stage leaves its neighbours drawn, that a restored session asks for a plate
      // rather than listing what is missing. Those are not checkable without a browser, so
      // they run in one.
      //
      // Same Gherkin either way. The split is in the runner, not in how the features are
      // written, which is what lets a scenario move between altitudes without being rewritten.
      {
        extends: true,
        test: {
          name: 'acceptance',
          include: ['features/**/*.feature'],
          exclude: [...UI_FEATURES],
          setupFiles: ['features/steps/index.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'acceptance:ui',
          include: [...UI_FEATURES],
          setupFiles: ['src/ui/setup.browser.ts', 'features/steps/ui/index.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        'src/domain/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/schemas/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/data/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
  },
})
