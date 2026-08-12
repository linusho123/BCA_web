/**
 * Run a test project repeatedly and keep the log of any run that fails.
 *
 * Written because a browser-project failure was seen once, in passing, and the detail was never
 * captured — which cost far more to chase later than recording it would have. A rerun-on-failure
 * setting would have been the wrong instrument: it hides exactly the evidence this exists to
 * keep. This does the opposite, and keeps the whole log of the run that failed.
 *
 *   node scripts/flake-hunt.mjs                        # 20 runs of acceptance:ui
 *   node scripts/flake-hunt.mjs --runs=50              # more runs
 *   node scripts/flake-hunt.mjs --project=component    # a different project
 *   node scripts/flake-hunt.mjs --project=all          # every project at once, as `verify` runs
 *   node scripts/flake-hunt.mjs --cold                 # clear the Vite prebundle each run
 *
 * `--project=all` is not a convenience. The one flake this repo has actually caught only
 * appears when the whole suite runs, because it needs the second Chromium project competing for
 * the machine — dozens of runs of the browser project alone never reproduced it, since isolating
 * the suspect removed the cause. Reach for `all` before concluding a failure is unreproducible.
 *
 * `--cold` matters for a class of failure that can only happen on a cold cache: Vite optimizes a
 * dependency the first time it is imported, and in browser mode that reload lands mid-run. The
 * prebundle is cached in node_modules/.vite between runs, so the second run onwards cannot
 * reproduce it — a green re-run proves nothing unless the cache started empty. See the
 * optimizeDeps comment in vite.config.ts.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// Imported rather than reached for as globals, matching scripts/standalone.mjs: these files are
// outside the TS project, so a global here is a lint error rather than an inference.
import { argv, exit, stdout } from 'node:process'

function say(line) {
  stdout.write(`${line}\n`)
}

function flag(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const runs = Number(flag('runs', '20'))
const project = flag('project', 'acceptance:ui')
const cold = argv.includes('--cold')
const outDir = flag('out', '.flake')

mkdirSync(outDir, { recursive: true })

// A run counts as a failure if vitest says so OR if the log carries a signature that does not
// always set a non-zero exit code — an unhandled rejection in a browser test can leave the
// summary green while the run is meaningless.
const SIGNATURES = [/Tests\s+.*failed/, /Unhandled (Error|Rejection)/, /reading 'context'/]

let failed = 0
for (let i = 1; i <= runs; i++) {
  if (cold) rmSync('node_modules/.vite', { recursive: true, force: true })

  const args = project === 'all' ? ['vitest', 'run'] : ['vitest', 'run', '--project', project]
  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const bad = result.status !== 0 || SIGNATURES.some((re) => re.test(log))

  if (bad) {
    failed += 1
    const path = join(outDir, `${project.replace(/\W+/g, '-')}-run-${i}.log`)
    writeFileSync(path, log)
    say(`run ${i}: FAILED — log kept at ${path}`)
  } else {
    say(`run ${i}: ok`)
  }
}

say(`\n${failed} of ${runs} runs failed${cold ? ' (cold cache)' : ''}.`)
exit(failed > 0 ? 1 : 0)
