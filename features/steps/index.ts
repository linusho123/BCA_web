/**
 * Acceptance test setup file — referenced by the `acceptance` project in vite.config.ts.
 *
 * Every step module must be imported here. Step definitions run at module top level:
 * importing the file IS the registration. Do not export functions from step modules.
 */

import './health.steps'
import './qc.steps'
import './reagent.steps'
import './dilution.steps'
import './linalg.steps'
import './curve.steps'
import './samples.steps'
import './plate.steps'
import './plot.steps'
import './export.steps'
