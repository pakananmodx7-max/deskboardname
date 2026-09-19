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
 * can only ever contain a single entry is what makes a future
 * "ทดสอบ 1 คน" button safe to wire up. Per item 5, that button itself
 * must stay disabled/unwired until detection has been revalidated live —
 * see popup.js's single-cell-test section, which builds this plan for
 * display/preview only and never attaches a click handler that would
 * actually call fillSgsColumnValues yet.
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
 * used by the (currently disabled) single-cell test preview. */
export function formatSingleCellTestSummary(plan) {
  if (!plan.valid) return 'ไม่สามารถสร้างแผนทดลองเขียนได้'
  const current = plan.currentValue === null ? 'ว่าง' : String(plan.currentValue)
  return `จะเปลี่ยนจาก ${current} เป็น ${plan.newValue} (1 ช่องเท่านั้น)`
}
