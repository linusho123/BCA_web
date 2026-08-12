/**
 * Fold the built site into one HTML file that runs by double-clicking it.
 *
 * Written here rather than pulled in as a plugin. The whole job is "read three files, write
 * one", and `AGENTS.md` asks for the reason and the rejected alternative: the alternative was
 * vite-plugin-singlefile, rejected because forty lines we can read beat a dependency we would
 * have to pin, audit and keep current for the rest of the project's life.
 *
 * Why this is worth having at all: a researcher who is handed a URL needs nothing, but a
 * researcher on a bench laptop with no network, or one who wants the exact version they used
 * for a figure six months from now, needs a copy. This is that copy — no install, no terminal,
 * no server. It opens from a USB stick.
 *
 * Two things here are not decoration:
 *
 * The replacements are functions, not strings. `String.replace` expands `$&` and `$1` in a
 * string replacement, and minified JavaScript is full of `$` sequences — passing the bundle as
 * a string silently corrupts it, which cost an afternoon and produced "SyntaxError: missing )
 * after argument list" from a file that looked perfectly fine.
 *
 * `</script` inside the bundle is neutralised. One occurrence anywhere in 700 KB would end the
 * inline script early and leave the rest of the app rendered as text.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// Imported rather than reached for as a global, so this file needs no lint exception.
import { stdout } from 'node:process'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')
const OUT = join(DIST, 'bca-web.html')

function only(suffix) {
  const found = readdirSync(ASSETS).filter((f) => f.endsWith(suffix))
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one ${suffix} in ${ASSETS}, found ${found.length}: ${found.join(', ')}. ` +
        'Code splitting would break the single-file build — inline them all or turn it off.',
    )
  }
  return join(ASSETS, found[0])
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const js = readFileSync(only('.js'), 'utf8')
const css = readFileSync(only('.css'), 'utf8')

const safe = (source) => source.split('</script').join('<\\/script')

let out = html
  .replace(/<link[^>]*href="[^"]*\.css"[^>]*>/, () => `<style>${css}</style>`)
  .replace(
    /<script[^>]*src="[^"]*\.js"[^>]*><\/script>/,
    () => `<script type="module">${safe(js)}</script>`,
  )

// A leftover reference would load nothing from a file:// page and fail silently, which is the
// one failure mode this file exists to prevent. Better to refuse to write it.
if (/(?:src|href)="[^"]*\/?assets\//.test(out)) {
  throw new Error('an asset reference survived inlining; the single file would not be standalone')
}

writeFileSync(OUT, out)
const mb = (statSync(OUT).size / 1024 / 1024).toFixed(2)
stdout.write(`${OUT}  ${mb} MB — open it by double-clicking; no server needed\n`)
