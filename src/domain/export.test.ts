import { describe, expect, it } from 'vitest'
import { fitCurve, standardLevel } from './curve'
import { isClose } from './linalg'
import { planDilutions } from './dilution'
import {
  curveToCsv,
  dilutionPlanToCsv,
  loadingToCsv,
  provenanceHeader,
  samplesToCsv,
  sessionToJson,
} from './export'
import {
  EXCEL_COEFFICIENTS,
  REFERENCE_DESIRED_PROTEIN_UG,
  REFERENCE_DILUTION_INPUT,
  REFERENCE_SAMPLES,
  referenceFit,
} from './reference'
import { analyseSamples, buildLoadingPlan } from './samples'

/** Proves features/export/result-export.feature. */

const FIT = referenceFit()
const RESULTS = analyseSamples(
  FIT,
  REFERENCE_SAMPLES.map((s) => ({ name: s.name, replicates: [s.absorbance] })),
  { dilutionFactor: 2 },
)
// 2 mL, not the workbook's 1 mL: 400 ug of the reference lysate is 750 uL of protein, and a
// 1 mL lane has only 750 uL left once a quarter of it is reserved for dye. The workbook's own
// lane is the infeasible case, exercised below.
const LOADING = buildLoadingPlan(RESULTS, {
  desiredProteinUg: REFERENCE_DESIRED_PROTEIN_UG,
  finalVolumeUL: 2000,
})

/** Data rows only: the provenance block and the column header are not rows of results. */
const dataRows = (csv: string): string[][] =>
  csv
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .slice(1)
    .map((line) => line.split(','))

const headerRow = (csv: string): string[] =>
  (csv.split('\n').find((line) => line !== '' && !line.startsWith('#')) ?? '').split(',')

const comments = (csv: string): string[] => csv.split('\n').filter((line) => line.startsWith('#'))

describe('the dilution plan export', () => {
  const csv = dilutionPlanToCsv(planDilutions(REFERENCE_DILUTION_INPUT))

  it('writes one row per vial under named columns', () => {
    expect(headerRow(csv)).toEqual([
      'vial_id',
      'final_conc_ug_per_mL',
      'final_conc_ug_per_uL',
      'source',
      'dilution_factor',
      'volume_from_source_uL',
      'volume_diluent_uL',
      'total_volume_uL',
      'leftover_uL',
      'issues',
    ])
    const rows = dataRows(csv)
    expect(rows).toHaveLength(9)
    expect(rows.map((r) => r[0])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
  })

  it('carries the workbook numbers into the cells', () => {
    const rowB = dataRows(csv).find((r) => r[0] === 'B') as string[]
    expect(rowB[1]).toBe('1500.00')
    expect(rowB[5]).toBe('78.75')
    expect(rowB[6]).toBe('26.25')
    expect(rowB[7]).toBe('105.00')
  })

  it('records the inputs that produced the plan, so it can be reproduced', () => {
    const block = comments(csv).join('\n')
    expect(block).toContain('volume per well (uL): 25')
    expect(block).toContain('replicates: 2')
    expect(block).toContain('overage factor: 2.1')
    expect(block).toContain('stock (ug/uL): 2')
  })
})

describe('the curve export', () => {
  const csv = curveToCsv(FIT)

  it('writes one row per standard', () => {
    expect(dataRows(csv)).toHaveLength(9)
    expect(headerRow(csv)).toContain('recovery_percent')
  })

  it('carries the coefficients and the fit quality into the provenance block', () => {
    const block = comments(csv).join('\n')
    expect(block).toContain('coefficients (highest power first)')
    // Full precision, not a rounded copy: the point of exporting a coefficient is that the curve
    // can be rebuilt from it, so each one is read back out and compared as a number.
    const line = comments(csv).find((l) => l.includes('coefficients')) as string
    const written = [...line.matchAll(/[a-d]=(-?[\d.e+-]+)/g)].map((m) => Number(m[1]))
    expect(written).toHaveLength(4)
    written.forEach((value, i) => {
      expect(isClose(value, EXCEL_COEFFICIENTS[i] as number, 1e-9)).toBe(true)
    })
    expect(block).toMatch(/r_squared: 0\.99/)
  })

  it('names the model and the blank-subtraction state', () => {
    expect(comments(csv).join('\n')).toContain('inverse_cubic')
    expect(comments(csv).join('\n')).toContain('blank subtracted: no')
    const subtracted = comments(curveToCsv(fitCurve(FIT.levels, { blankSubtract: true })))
    expect(subtracted.join('\n')).toContain('blank subtracted: yes')
    expect(subtracted.join('\n')).toContain('blank mean absorbance: 0.1320')
  })

  it('records the calibrated range, which is what makes an extrapolation flag readable', () => {
    expect(comments(csv).join('\n')).toContain('calibrated absorbance range')
  })

  it('exports a failed fit as its failure rather than throwing', () => {
    // "No file was produced" is indistinguishable from "nobody ran it".
    const broken = fitCurve([standardLevel(0, [0.132], 'I')], { blankSubtract: false })
    expect(broken.fitted).toBe(false)
    const failed = curveToCsv(broken)
    expect(comments(failed).join('\n')).toContain('curve did not fit')
    expect(comments(failed).some((line) => line.startsWith('# issue:'))).toBe(true)
    expect(dataRows(failed)).toHaveLength(1)
  })
})

describe('the sample export', () => {
  const csv = samplesToCsv(RESULTS, { fit: FIT, dilutionFactor: 2 })

  it('carries concentrations at full precision, because this column feeds a figure', () => {
    const rows = dataRows(csv)
    // Seventeen significant digits, not a rounded copy: this column gets pasted into a figure.
    expect(rows[0]?.[5]).toBe(String(RESULTS[0]?.concUgPerML))
    expect(rows[0]?.[5]?.split('.')[1]?.length).toBeGreaterThan(6)
    expect(isClose(Number(rows[0]?.[5]), REFERENCE_SAMPLES[0].concUgPerML, 1e-9)).toBe(true)
    expect(isClose(Number(rows[0]?.[6]), REFERENCE_SAMPLES[0].concUgPerUL, 1e-9)).toBe(true)
    expect(isClose(Number(rows[1]?.[5]), REFERENCE_SAMPLES[1].concUgPerML, 1e-9)).toBe(true)
  })

  it('records the dilution factor it applied', () => {
    expect(comments(csv).join('\n')).toContain('sample dilution factor: 2')
    expect(dataRows(csv)[0]?.[7]).toBe('2')
  })

  it('says in the row itself whether a sample was extrapolated', () => {
    expect(dataRows(csv).map((r) => r[8])).toEqual(['no', 'no'])
    const high = samplesToCsv(analyseSamples(FIT, [{ name: 'High', replicates: [2.5] }]))
    expect(dataRows(high)[0]?.[8]).toBe('yes')
  })
})

describe('the loading export', () => {
  const csv = loadingToCsv(LOADING)

  it('carries the three pipetting volumes', () => {
    const header = headerRow(csv)
    expect(header).toContain('protein_uL')
    expect(header).toContain('diluent_uL')
    expect(header).toContain('dye_uL')
    const row = dataRows(csv)[0] as string[]
    expect(Number(row[2])).toBeCloseTo(REFERENCE_SAMPLES[0].proteinUL, 2)
    expect(row[6]).toBe('yes')
    // The three volumes sum to the final volume they were computed against.
    expect(Number(row[2]) + Number(row[3]) + Number(row[4])).toBeCloseTo(Number(row[5]), 1)
  })

  it('leaves the diluent cell empty on a lane that does not fit', () => {
    // An infeasible lane reports its diluent as absent rather than negative: a negative number
    // in a volume column is one glance away from being read as a volume.
    const tight = buildLoadingPlan(RESULTS, { desiredProteinUg: 400, finalVolumeUL: 5 })
    const row = dataRows(loadingToCsv(tight))[0] as string[]
    expect(row[6]).toBe('no')
    expect(row[3]).toBe('')
    // The protein volume is still there, because it is the actionable number.
    expect(row[2]).not.toBe('')
  })
})

describe('issues and absences in a row', () => {
  it('carries the issue codes attached to the row that raised them', () => {
    const results = analyseSamples(FIT, [{ name: 'High', replicates: [2.5] }])
    const row = dataRows(samplesToCsv(results))[0] as string[]
    expect(row[9]).toContain('EXTRAPOLATED')
  })

  it('joins several codes into one field without breaking the row', () => {
    // Codes join on a semicolon precisely so a multi-issue row still splits into ten columns
    // for a reader that does nothing cleverer than splitting on commas.
    const results = analyseSamples(FIT, [{ name: 'Messy', replicates: [2.4, 2.6, NaN] }])
    const row = dataRows(samplesToCsv(results))[0] as string[]
    expect(row).toHaveLength(10)
    expect(row[9]?.split('; ').length).toBeGreaterThan(1)
  })

  it('exports an absent value as an empty field rather than as "None"', () => {
    // Text in a numeric column is how a spreadsheet's sum silently stops working.
    const results = analyseSamples(FIT, [{ name: 'Ghost', replicates: [null] }])
    const row = dataRows(samplesToCsv(results))[0] as string[]
    expect(row[2]).toBe('')
    expect(row[5]).toBe('')
    expect(row.join(',')).not.toContain('None')
    expect(row.join(',')).not.toContain('NaN')
  })

  it('exports an empty result set as a header and nothing else', () => {
    const csv = samplesToCsv([])
    expect(dataRows(csv)).toEqual([])
    expect(headerRow(csv)[0]).toBe('sample')
  })
})

describe('names that carry CSV punctuation', () => {
  it.each([
    ['a comma', 'MCF7, passage 12'],
    ['a quote', 'MCF7 "high"'],
    ['a newline', 'MCF7\nlysate'],
    ['both', 'A,B"C'],
  ])('quotes %s so the row keeps its column count', (_name, sampleName) => {
    const results = analyseSamples(FIT, [{ name: sampleName, replicates: [0.43] }])
    const csv = samplesToCsv(results)
    const body = csv.split('\n').filter((l) => !l.startsWith('#')).join('\n')
    expect(body).toContain('"')
    // Round-trip through a minimal RFC4180 reader: the name comes back exactly as it went in.
    expect(readCsv(body)[1]?.[0]).toBe(sampleName)
  })
})

/** A minimal RFC4180 reader, here only to prove the writer's quoting is readable. */
function readCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

describe('the session JSON', () => {
  it('round-trips the whole session', () => {
    const json = sessionToJson({ fit: FIT, samples: RESULTS, loading: LOADING, dilutionFactor: 2 })
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.generatedBy).toBe('BCA_web')
    expect(typeof parsed.generatedAt).toBe('string')
    expect((parsed.samples as unknown[]).length).toBe(2)
    const coefficients = (parsed.fit as { coefficients: number[] }).coefficients
    expect(coefficients).toHaveLength(4)
    coefficients.forEach((c, i) => {
      expect(isClose(c, EXCEL_COEFFICIENTS[i] as number, 1e-9)).toBe(true)
    })
  })

  it('serialises a non-finite number as null rather than as invalid JSON', () => {
    // JSON.stringify writes bare NaN as null at the top level, but the guarantee is easier to
    // make by normalising than by reasoning about where it applies.
    const json = sessionToJson({
      samples: [
        {
          name: 'Broken',
          replicates: [NaN],
          n: 1,
          meanAbs: NaN,
          sdAbs: Infinity,
          cvPercent: -Infinity,
          concUgPerML: null,
          concUgPerUL: null,
          dilutionFactor: 1,
          extrapolated: false,
          issues: [],
        },
      ],
    })
    expect(json).not.toContain('NaN')
    expect(json).not.toContain('Infinity')
    const sample = (JSON.parse(json) as { samples: Array<Record<string, unknown>> }).samples[0]
    expect(sample?.meanAbs).toBeNull()
    expect(sample?.sdAbs).toBeNull()
  })

  it('omits what it was not given rather than inventing empty sections', () => {
    const parsed = JSON.parse(sessionToJson({})) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['generatedBy', 'generatedAt'])
  })
})

describe('the provenance block itself', () => {
  it('always names the app that wrote the file', () => {
    expect(provenanceHeader()[0]).toContain('BCA_web')
  })

  it('is comment lines only, so a reader that skips them lands on the header', () => {
    expect(provenanceHeader({ fit: FIT, dilutionFactor: 2 }).every((l) => l.startsWith('#')))
      .toBe(true)
  })

  it('says nothing about a curve or a dilution factor it was not given', () => {
    const lines = provenanceHeader().join('\n')
    expect(lines).not.toContain('fit model')
    expect(lines).not.toContain('dilution factor')
  })
})
