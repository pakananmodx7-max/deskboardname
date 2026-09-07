import { ALL_HEADER_ALIASES, normalizeHeader } from '@/features/student-import/student-import-mapper'

/**
 * Two spec-required terms that aren't tied to any ImportTargetField (there
 * is no "prefix" or "classroom name" column we import), so they don't
 * already exist in the mapper's alias table — added here specifically so
 * header rows that use them still score correctly.
 */
const EXTRA_HEADER_TERMS = ['คำนำหน้า', 'ห้อง']

const HEADER_TERMS = Array.from(new Set([...ALL_HEADER_ALIASES, ...EXTRA_HEADER_TERMS]))
const NORMALIZED_HEADER_TERMS = new Set(HEADER_TERMS.map(normalizeHeader))

/** How many rows from the top of the sheet are eligible to be the header. */
export const HEADER_SCAN_LIMIT = 20

/**
 * Below this confidence, auto-detection is not trusted enough to skip
 * straight to the mapping step — the dialog shows a manual "เลือกแถวหัวตาราง"
 * picker instead, pre-selected to this same best guess.
 */
export const HEADER_DETECTION_CONFIDENCE_THRESHOLD = 0.6

export interface HeaderRowCandidate {
  rowIndex: number
  /** Count of distinct cells in this row that matched a known header term. */
  score: number
  /** score divided by the row's non-blank cell count (0 for an all-blank row). */
  matchRatio: number
}

export interface HeaderDetectionResult {
  headerRowIndex: number
  /** 0..1 — see HEADER_DETECTION_CONFIDENCE_THRESHOLD for how the dialog uses this. */
  confidence: number
  /** One entry per scanned row (up to HEADER_SCAN_LIMIT), in original order —
   * used to render the manual picker when confidence is low. */
  candidates: HeaderRowCandidate[]
}

function scoreRow(row: string[]): { score: number; matchRatio: number } {
  const nonBlankCells = row.filter((cell) => cell.trim() !== '')
  if (nonBlankCells.length === 0) {
    return { score: 0, matchRatio: 0 }
  }

  let score = 0
  for (const cell of nonBlankCells) {
    if (NORMALIZED_HEADER_TERMS.has(normalizeHeader(cell))) {
      score += 1
    }
  }

  return { score, matchRatio: score / nonBlankCells.length }
}

/**
 * Scores the first HEADER_SCAN_LIMIT rows of a parsed sheet as candidate
 * header rows, so real school spreadsheets that put a school name, class
 * name, academic year, or blank spacer rows above the actual student table
 * still get their header row found automatically instead of always
 * assuming row 0 is the header.
 *
 * Scoring: a row's score is how many of its non-blank cells exactly match
 * a known header term (เลขที่/ลำดับ/รหัสนักเรียน/ชื่อ/นามสกุล/ชื่อเล่น/ห้อง/
 * email/phone/etc. — the same alias vocabulary autoDetectMapping uses, see
 * ALL_HEADER_ALIASES). A title row like "โรงเรียนทดสอบวิทยา — ม.5/1" scores 0
 * (none of its cells are header words), a real header row scores highly
 * (most or all of its cells are header words).
 *
 * Confidence combines two signals so a single accidental word match can't
 * masquerade as a confident header row:
 *   - matchRatio: what fraction of the winning row's own cells matched —
 *     a row of ["ชื่อ", "นามสกุล", "เลขที่"] (3/3) is far more convincing
 *     than a 10-column data row that happens to have one cell literally
 *     reading "ชื่อ" (1/10).
 *   - dominance: how much the winner's raw score beats the runner-up's —
 *     a clear single winner is trustworthy; two rows with similar scores
 *     (e.g. a merged-cell title row that partially repeats header-ish
 *     words) means the file is ambiguous and a human should decide.
 */
export function detectHeaderRow(rows: string[][]): HeaderDetectionResult {
  const scanRows = rows.slice(0, HEADER_SCAN_LIMIT)
  const candidates: HeaderRowCandidate[] = scanRows.map((row, rowIndex) => {
    const { score, matchRatio } = scoreRow(row)
    return { rowIndex, score, matchRatio }
  })

  if (candidates.length === 0) {
    return { headerRowIndex: 0, confidence: 0, candidates: [] }
  }

  let best = candidates[0]
  for (const candidate of candidates) {
    if (candidate.score > best.score) best = candidate
  }

  const MIN_SCORE_FOR_AUTO = 2
  if (best.score < MIN_SCORE_FOR_AUTO) {
    return { headerRowIndex: best.rowIndex, confidence: 0, candidates }
  }

  // Ties count against the winner too, not just close-but-lower scores:
  // filtering strictly by rowIndex (rather than by score) means a row
  // that scores equal to the winner still shows up as the "runner-up"
  // here, driving dominance to 0 — a real tie is exactly the case a
  // human should confirm, not something to silently resolve by row order.
  const runnerUpScore = Math.max(
    0,
    ...candidates.filter((c) => c.rowIndex !== best.rowIndex).map((c) => c.score),
  )
  const dominance = runnerUpScore === 0 ? 1 : Math.max(0, (best.score - runnerUpScore) / best.score)
  // Equal weight: a perfect-match row (matchRatio 1) with a perfectly-tied
  // competitor (dominance 0) must land BELOW HEADER_DETECTION_CONFIDENCE_THRESHOLD
  // (1*0.5 + 0*0.5 = 0.5 < 0.6) rather than exactly at the boundary.
  const confidence = Math.min(1, best.matchRatio * 0.5 + dominance * 0.5)

  return { headerRowIndex: best.rowIndex, confidence, candidates }
}
