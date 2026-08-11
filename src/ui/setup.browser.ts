/**
 * Loads the app's stylesheet into every browser-mode test.
 *
 * Without it, Tailwind's utilities are absent and every class in a component is inert — which
 * matters more than it sounds. The chart positions its focusable marks with `absolute` inside
 * a `relative` container; with no stylesheet those two are no-ops, the marks land in document
 * flow, and a test asserting they exist passes while the thing it describes is not happening.
 *
 * Running the real CSS is the point of testing in a browser at all.
 */

import '~/index.css'
