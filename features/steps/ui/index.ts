/**
 * The browser step registry.
 *
 * Step definitions run at module top level: importing the file IS the registration. Do not export
 * functions from step modules.
 *
 * Separate from features/steps/index.ts because these two feature files run in a real browser and
 * the other sixteen do not. QuickPickle's registry is per-setup-file, so a sentence registered
 * here and a sentence registered there can be worded the same without colliding.
 */

import './support'
import './analysis.steps'
import './curve-plot.steps'
import './curve-crowding.steps'
import './plate-grid.steps'
import './painting.steps'
import './paint-drag.steps'
import './import.steps'
import './direction.steps'
