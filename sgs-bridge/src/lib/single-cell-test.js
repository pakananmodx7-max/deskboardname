/**
 * LIVE DISCOVERY, item 5: the real SGS page auto-saves — there is no
 * Save button, and the page itself says so ("Page นี้ใช้ระบบบันทึก
 * อัตโนมัติ ไม่ต้องคลิกปุ่ม Save"). That turns every DOM write from
 * "reversible until Save" into "potentially live the instant it
 * happens," so the previous "fill a whole column, then the teacher
 * reviews and clicks Save" architecture is unsafe here. Before any bulk
 * write is ever re-introduced, a much narrower, explicitly-confirmed
 * "ทดสอบ 1 คน" (test one student) mode is required: exactly one
 * student, exactly one column, exactly one cell — never more.
 *
 * This module only ever computes that ONE-cell plan. It never touches
 * the DOM itself — content-diagnostic.js's existing fillSgsColumnValues
 * already writes ONLY the offsets it's given (see its own doc comment),
 * so reusing it with a writesByOffset map that this module GUARANTEES
 * can only ever contain a single entry is what makes the "ทดสอบ 1 คน"
 * button safe to wire up.
 *
 * CONTROLLED LIVE TEST (this phase): the write button/checkbox are now
 * wired up in popup.js, but ONLY once every precondition below holds —
 * see evaluateSingleCellTestPreconditions, the one place all of them are
 * checked together, and canEnableSingleCellTestWrite, which additionally
 * requires the teacher's own explicit consent checkbox. Both are pure
 * and DOM-free so they can be unit tested directly; popup.js re-runs
 * them on every input change (student/column selection, checkbox
 * toggle) rather than trusting a stale answer.
 */

/**
 * @param {{ sgsRowOffset: number, columnIndex: number, columnKey: string, currentValue: number|null, newValue: number|null|undefined }} input
 */
export function buildSingleCellTestPlan({ sgsRowOffset, columnIndex, columnKey, currentValue, newValue }) {
  if (!Number.isInteger(sgsRowOffset) || sgsRowOffset < 0) {
    return { valid: false, reason: 'invalid_row', writesByOffset: {} }
  }
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    return { valid: false, reason: 'invalid_column', writesByOffset: {} }
  }
  const numericNewValue = Number(newValue)
  if (newValue === null || newValue === undefined || !Number.isFinite(numericNewValue)) {
    return { valid: false, reason: 'invalid_value', writesByOffset: {} }
  }

  return {
    valid: true,
    reason: null,
    sgsRowOffset,
    columnIndex,
    columnKey,
    currentValue: currentValue ?? null,
    newValue: numericNewValue,
    // The ENTIRE point of this module: a writesByOffset map that can
    // NEVER contain more than the one requested offset — see
    // singleCellTestWriteCount below, which every caller/test uses to
    // verify that invariant rather than trusting it by construction
    // alone.
    writesByOffset: { [sgsRowOffset]: numericNewValue },
  }
}

/** How many cells a plan would actually write — must always be exactly
 * 1 for a valid plan, 0 for an invalid one. Never any other number. */
export function singleCellTestWriteCount(plan) {
  return Object.keys(plan.writesByOffset ?? {}).length
}

/** A short Thai display line for the plan's current → proposed value,
 * used by the single-cell test preview. */
export function formatSingleCellTestSummary(plan) {
  if (!plan.valid) return 'ไม่สามารถสร้างแผนทดลองเขียนได้'
  const current = plan.currentValue === null ? 'ว่าง' : String(plan.currentValue)
  return `จะเปลี่ยนจาก ${current} เป็น ${plan.newValue} (1 ช่องเท่านั้น)`
}

/**
 * The ONE place every "safe to even let the teacher tick the consent
 * checkbox" condition is checked together. Deliberately returns as soon
 * as the FIRST failing condition is found (never a batch of reasons) so
 * the UI always shows one unambiguous next step, and deliberately checks
 * MORE than buildSingleCellTestPlan alone would: a valid plan only means
 * "these numbers are well-formed," not "it is safe to write them" (that
 * also needs high detection confidence, a genuinely writable column, the
 * teacher's own header-checkbox action already done, and a row that
 * currently has exactly one live input to write into).
 *
 * Every field here is plain data — no DOM object, no element reference —
 * so this can be (and is) called from a real DOM context in popup.js AND
 * from a unit test with a plain object, with identical behavior.
 *
 * @param {{
 *   studentGridFound: boolean,
 *   confidence: 'none'|'low'|'medium'|'high',
 *   selectedStudentCount: number,
 *   selectedColumnCount: number,
 *   columnIsWritable: boolean,
 *   headerCheckboxOk: boolean,
 *   cellInputState: { visible: boolean, enabled: boolean, visibleInputCount: number } | null,
 *   proposedScore: number | null | undefined,
 *   maxScore: number | null | undefined,
 * }} input
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function evaluateSingleCellTestPreconditions({
  studentGridFound,
  confidence,
  selectedStudentCount,
  selectedColumnCount,
  columnIsWritable,
  headerCheckboxOk,
  cellInputState,
  proposedScore,
  maxScore,
}) {
  if (!studentGridFound) {
    return { ok: false, reason: 'ยังไม่พบตารางคะแนนนักเรียนที่มั่นใจได้ในหน้านี้' }
  }
  if (confidence !== 'high') {
    return { ok: false, reason: `ความเชื่อมั่นในการตรวจจับตารางต้องอยู่ระดับ "high" เท่านั้น (ปัจจุบัน: ${confidence})` }
  }
  if (selectedStudentCount !== 1) {
    return { ok: false, reason: 'ต้องเลือกนักเรียนให้ครบและเพียง 1 คนเท่านั้น' }
  }
  if (selectedColumnCount !== 1) {
    return { ok: false, reason: 'ต้องเลือกคอลัมน์คะแนนให้ครบและเพียง 1 ช่องเท่านั้น' }
  }
  if (!columnIsWritable) {
    return { ok: false, reason: 'คอลัมน์ที่เลือกไม่ใช่ช่องคะแนนที่กรอกได้จริงในขณะนี้ (writableScoreColumn)' }
  }
  if (!headerCheckboxOk) {
    return { ok: false, reason: 'กรุณาติ๊กเปิดช่องคะแนนนี้ด้วยตนเองใน SGS ก่อน แล้วกด "สแกนใหม่"' }
  }
  if (!cellInputState || !cellInputState.visible || !cellInputState.enabled) {
    return { ok: false, reason: 'ไม่พบช่องกรอกที่มองเห็นและกรอกได้จริงในแถว/คอลัมน์ที่เลือกขณะนี้' }
  }
  if (cellInputState.visibleInputCount !== 1) {
    return { ok: false, reason: 'แถวนี้มีช่องกรอกที่มองเห็นได้มากกว่า 1 ช่อง — ไม่ปลอดภัยที่จะเขียน' }
  }
  if (proposedScore === null || proposedScore === undefined || !Number.isFinite(proposedScore) || proposedScore < 0) {
    return { ok: false, reason: 'คะแนนที่จะบันทึกไม่ถูกต้อง' }
  }
  if (maxScore !== null && maxScore !== undefined && proposedScore > maxScore) {
    return { ok: false, reason: `คะแนนต้องไม่เกินคะแนนเต็มของคอลัมน์นี้ (${maxScore})` }
  }
  return { ok: true, reason: null }
}

/** The write button's OWN gate: every precondition above AND the
 * teacher's explicit, freshly-read consent checkbox. Never the reverse
 * order (a checked box can never substitute for a missing precondition,
 * and a passing precondition can never substitute for consent). */
export function canEnableSingleCellTestWrite(preconditionsOk, consentChecked) {
  return preconditionsOk === true && consentChecked === true
}

/**
 * The "guard against stale DOM" gate required immediately before the
 * actual write — compares whatever was true when the teacher last
 * previewed this cell against a FRESH read taken right before writing.
 * Every field must match exactly; any drift (a different subject/
 * classroom selected in SGS, the page re-sorted/re-paginated so a
 * different student now sits at the same row offset, the column's
 * header checkbox toggled off, the input having disappeared or become
 * disabled) means abort — never write over a context this module can no
 * longer vouch for.
 *
 * @param {{ subjectFilterText: string|null, classroomFilterText: string|null, studentNumber: number|null, studentCode: string|null, studentName: string, columnKey: string }} confirmed
 * @param {{ subjectFilterText: string|null, classroomFilterText: string|null, studentNumber: number|null, studentCode: string|null, studentName: string, columnKey: string, cellVisible: boolean, cellEnabled: boolean, visibleInputCount: number }} fresh
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function revalidateSingleCellTestContext(confirmed, fresh) {
  if (confirmed.subjectFilterText !== fresh.subjectFilterText) {
    return { ok: false, reason: 'ตัวกรองวิชาบนหน้า SGS เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (confirmed.classroomFilterText !== fresh.classroomFilterText) {
    return { ok: false, reason: 'ตัวกรองห้องเรียนบนหน้า SGS เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (confirmed.studentNumber !== fresh.studentNumber || confirmed.studentCode !== fresh.studentCode || confirmed.studentName !== fresh.studentName) {
    return { ok: false, reason: 'แถวนักเรียนที่ตำแหน่งนี้เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง (อาจมีการจัดเรียง/เปลี่ยนหน้าใน SGS) — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (confirmed.columnKey !== fresh.columnKey) {
    return { ok: false, reason: 'คอลัมน์ที่เลือกเปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (!fresh.cellVisible || !fresh.cellEnabled || fresh.visibleInputCount !== 1) {
    return { ok: false, reason: 'ช่องกรอกของแถว/คอลัมน์นี้ไม่พร้อมเขียนอีกต่อไป (ถูกซ่อน/ปิดใช้งาน/มีมากกว่า 1 ช่อง) — ยกเลิกเพื่อความปลอดภัย' }
  }
  return { ok: true, reason: null }
}
