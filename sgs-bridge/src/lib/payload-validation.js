/**
 * Mirrors src/services/sgs-export-service.ts's validateSgsBridgePayload
 * EXACTLY, for the same reason mapping.js/column-fill.js mirror their
 * counterparts — this extension cannot import a TS module from the main
 * app's src/. The extension re-validates every payload a teacher loads
 * from disk, even though KrunameClass already validated it before
 * offering the download: a hand-edited or corrupted file must never be
 * trusted just because it has the right shape at a glance.
 *
 * v2 requires `targetColumn` and `overwriteMode` — a payload missing
 * either is rejected outright, since this extension must never write to
 * SGS without an explicit, single target column and an explicit
 * overwrite choice.
 */
export const SGS_BRIDGE_PAYLOAD_VERSION = 2

const OVERWRITE_MODES = ['skip_existing', 'overwrite_selected_column']

const FORBIDDEN_KEY_PATTERN = /password|token|cookie|secret|service_?role|credential|session/i

function findForbiddenKey(value, path = '') {
  if (value === null || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_KEY_PATTERN.test(key)) return childPath
    const nested = findForbiddenKey(child, childPath)
    if (nested) return nested
  }
  return null
}

export function validateSgsBridgePayload(raw) {
  const errors = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }
  const payload = raw

  if (payload.version !== SGS_BRIDGE_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_BRIDGE_PAYLOAD_VERSION})`)
  }

  const requiredStringFields = [
    'subjectId',
    'subjectName',
    'classroomId',
    'classroomName',
    'assignmentId',
    'assignmentTitle',
  ]
  for (const field of requiredStringFields) {
    if (typeof payload[field] !== 'string' || payload[field].trim() === '') {
      errors.push(`${field} ต้องเป็นข้อความที่ไม่ว่าง`)
    }
  }

  const assignmentMaxScore = payload.assignmentMaxScore
  if (typeof assignmentMaxScore !== 'number' || !Number.isFinite(assignmentMaxScore) || assignmentMaxScore <= 0) {
    errors.push('assignmentMaxScore ต้องเป็นตัวเลขมากกว่า 0')
  }

  let targetColumnMaxScore = null
  const targetColumn = payload.targetColumn
  if (typeof targetColumn !== 'object' || targetColumn === null) {
    errors.push('targetColumn ต้องเป็น object')
  } else {
    if (typeof targetColumn.key !== 'string' || targetColumn.key.trim() === '') {
      errors.push('targetColumn.key ต้องเป็นข้อความที่ไม่ว่าง')
    }
    if (typeof targetColumn.label !== 'string' || targetColumn.label.trim() === '') {
      errors.push('targetColumn.label ต้องเป็นข้อความที่ไม่ว่าง')
    }
    if (typeof targetColumn.maxScore !== 'number' || !Number.isFinite(targetColumn.maxScore) || targetColumn.maxScore <= 0) {
      errors.push('targetColumn.maxScore ต้องเป็นตัวเลขมากกว่า 0')
    } else {
      targetColumnMaxScore = targetColumn.maxScore
    }
  }

  if (!OVERWRITE_MODES.includes(payload.overwriteMode)) {
    errors.push(`overwriteMode ต้องเป็นหนึ่งใน ${OVERWRITE_MODES.join(', ')}`)
  }

  if (!Array.isArray(payload.students)) {
    errors.push('students ต้องเป็น array')
  } else {
    payload.students.forEach((row, index) => {
      if (typeof row !== 'object' || row === null) {
        errors.push(`students[${index}] ต้องเป็น object`)
        return
      }
      if (typeof row.studentId !== 'string' || row.studentId.trim() === '') {
        errors.push(`students[${index}].studentId ไม่ถูกต้อง`)
      }
      if (typeof row.fullName !== 'string' || row.fullName.trim() === '') {
        errors.push(`students[${index}].fullName ไม่ถูกต้อง`)
      }
      if (row.studentNumber !== null && typeof row.studentNumber !== 'number') {
        errors.push(`students[${index}].studentNumber ต้องเป็นตัวเลขหรือ null`)
      }
      if (typeof row.score !== 'number' || !Number.isFinite(row.score)) {
        errors.push(`students[${index}].score ต้องเป็นตัวเลข (ห้ามเป็น null)`)
      } else {
        if (row.score < 0) errors.push(`students[${index}].score ติดลบไม่ได้`)
        if (typeof assignmentMaxScore === 'number' && row.score > assignmentMaxScore) {
          errors.push(`students[${index}].score (${row.score}) เกินคะแนนเต็มของงาน (${assignmentMaxScore})`)
        }
        if (targetColumnMaxScore !== null && row.score > targetColumnMaxScore) {
          errors.push(`students[${index}].score (${row.score}) เกินคะแนนเต็มของช่อง SGS ที่เลือก (${targetColumnMaxScore})`)
        }
      }
    })
  }

  const forbiddenPath = findForbiddenKey(payload)
  if (forbiddenPath) {
    errors.push(`payload ห้ามมีข้อมูลลับ (พบ key ต้องสงสัย: ${forbiddenPath})`)
  }

  return { ok: errors.length === 0, errors }
}
