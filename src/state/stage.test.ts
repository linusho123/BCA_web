import { describe, expect, it } from 'vitest'
import { IssueCode, issue, Severity, Stage } from '~/domain/errors'
import { atSeverity, collect, failed, staged } from './stage'

const anIssue = (severity: Severity, code: IssueCode = IssueCode.CV_WARN) =>
  issue(code, severity, `${code} at ${severity}`)

describe('staged', () => {
  it('tags every issue with the stage that raised it', () => {
    const s = staged(Stage.CURVE, 42, [anIssue(Severity.WARN), anIssue(Severity.ERROR)])
    expect(s.issues.map((i) => i.stage)).toEqual([Stage.CURVE, Stage.CURVE])
  })

  it('leaves the value untouched', () => {
    expect(staged(Stage.PLATE, { a: 1 }, []).value).toEqual({ a: 1 })
  })

  it('keeps the fields the domain put on the issue', () => {
    const original = issue(IssueCode.POOR_FIT, Severity.WARN, 'r² is low', 'curve', { r2: 0.9 })
    const [tagged] = staged(Stage.CURVE, null, [original]).issues
    expect(tagged).toMatchObject({
      code: IssueCode.POOR_FIT,
      message: 'r² is low',
      field: 'curve',
      context: [['r2', '0.9']],
    })
  })
})

describe('failed', () => {
  it('is true when any issue is an error', () => {
    expect(failed(staged(Stage.PLATE, null, [anIssue(Severity.WARN), anIssue(Severity.ERROR)])))
      .toBe(true)
  })

  it('is false for warnings and notes alone', () => {
    expect(failed(staged(Stage.PLATE, null, [anIssue(Severity.WARN), anIssue(Severity.INFO)])))
      .toBe(false)
  })

  it('is false when there is nothing to report', () => {
    expect(failed(staged(Stage.PLATE, null, []))).toBe(false)
  })
})

describe('collect', () => {
  it('runs in stage order', () => {
    const all = collect(
      staged(Stage.PLATE, null, [anIssue(Severity.WARN)]),
      staged(Stage.CURVE, null, [anIssue(Severity.WARN)]),
    )
    expect(all.map((i) => i.stage)).toEqual([Stage.PLATE, Stage.CURVE])
  })

  it('puts errors before warnings before notes within a stage', () => {
    const all = collect(
      staged(Stage.CURVE, null, [
        anIssue(Severity.INFO),
        anIssue(Severity.WARN),
        anIssue(Severity.ERROR),
      ]),
    )
    expect(all.map((i) => i.severity)).toEqual([Severity.ERROR, Severity.WARN, Severity.INFO])
  })

  it('does not reorder across stages, so an early warning still precedes a late error', () => {
    // Stage order is the workflow order, and the workflow order is what a reader is scanning.
    // Sorting globally by severity would put a loading error above the plate warning that
    // caused it.
    const all = collect(
      staged(Stage.PLATE, null, [anIssue(Severity.WARN)]),
      staged(Stage.LOADING, null, [anIssue(Severity.ERROR)]),
    )
    expect(all.map((i) => i.stage)).toEqual([Stage.PLATE, Stage.LOADING])
  })

  it('is empty when no stage complained', () => {
    expect(collect(staged(Stage.PLATE, null, []), staged(Stage.CURVE, null, []))).toEqual([])
  })
})

describe('atSeverity', () => {
  it('selects one group', () => {
    const all = collect(
      staged(Stage.CURVE, null, [anIssue(Severity.ERROR), anIssue(Severity.WARN)]),
    )
    expect(atSeverity(all, Severity.ERROR)).toHaveLength(1)
    expect(atSeverity(all, Severity.INFO)).toEqual([])
  })
})
