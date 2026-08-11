/**
 * Hand a string to the browser as a file.
 *
 * A blob and an object URL rather than a `data:` URI, because a plate of samples exported as
 * JSON runs past what some browsers accept in a URL, and the failure is silent when it does.
 *
 * The object URL is revoked on the next frame rather than immediately: the click has to be
 * dispatched and the navigation started first, and revoking in the same tick cancels it in some
 * browsers.
 */
export function download(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()

  requestAnimationFrame(() => URL.revokeObjectURL(url))
}
