/**
 * The file and paste boundary.
 *
 * Everything a user can drop, paste or type into the plate loader passes through here before it
 * reaches `parsePlate`. The parser is already tolerant and already never throws, so this layer
 * is about the things a parser should not be asked to judge: how large a paste may be, and
 * whether a `File` handed over by a drop event is the shape the DOM claims it is.
 */

import { z } from 'zod'
import { type Issue, IssueCode, Severity, issue } from '~/domain/errors'

/**
 * A 384-well plate of long readings, with instrument headers, is comfortably under 64 KB. The
 * cap is not about memory; it is that the whole reactive chain re-runs on every keystroke in
 * the paste box, and a megabyte pasted by accident makes the page feel broken rather than busy.
 */
export const MAX_PLATE_TEXT_BYTES = 1 << 16

/** Files are read into memory whole, so the cap is the same one, an order of magnitude looser. */
export const MAX_UPLOAD_BYTES = 1 << 20

export const PlateTextSchema = z
  .string()
  .max(MAX_PLATE_TEXT_BYTES, { message: 'that is far larger than a plate; paste only the grid' })

/** Validate a pasted grid, returning issues rather than throwing. */
export function validatePlateText(raw: string): { text: string; issues: Issue[] } {
  const result = PlateTextSchema.safeParse(raw)
  if (result.success) return { text: result.data, issues: [] }
  return {
    text: '',
    issues: [
      issue(
        IssueCode.NON_NUMERIC_INPUT,
        Severity.ERROR,
        result.error.issues[0]?.message ?? 'the pasted text could not be read',
        'text',
      ),
    ],
  }
}

/**
 * The shape of a `File` this app is willing to read.
 *
 * Checked structurally rather than with `instanceof File`, because the object arrives from a
 * drop event, a file input or a test, and only one of those three produces a real `File`.
 */
export const UploadSchema = z.object({
  name: z.string().default(''),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES, {
    message: 'that file is far larger than a plate export; save just the grid as CSV',
  }),
  arrayBuffer: z.custom<() => Promise<ArrayBuffer>>((v) => typeof v === 'function', {
    message: 'that is not a readable file',
  }),
})

export type Upload = z.infer<typeof UploadSchema>

/**
 * Read an uploaded file to bytes, reporting a refusal as an issue.
 *
 * Deciding *what* the bytes are — a workbook, an image, a CSV — is `decodePlateBytes`'s job and
 * stays there, because the signatures it checks are part of the plate story rather than part of
 * the upload story.
 */
export async function readUpload(
  file: unknown,
): Promise<{ bytes: Uint8Array | null; issues: Issue[] }> {
  const parsed = UploadSchema.safeParse(file)
  if (!parsed.success) {
    return {
      bytes: null,
      issues: [
        issue(
          IssueCode.UNDECODABLE_UPLOAD,
          Severity.ERROR,
          parsed.error.issues[0]?.message ?? 'that file could not be read',
          'file',
        ),
      ],
    }
  }

  try {
    return { bytes: new Uint8Array(await parsed.data.arrayBuffer()), issues: [] }
  } catch {
    return {
      bytes: null,
      issues: [
        issue(
          IssueCode.UNDECODABLE_UPLOAD,
          Severity.ERROR,
          'the file could not be read from disk; try saving it again as CSV',
          'file',
        ),
      ],
    }
  }
}
