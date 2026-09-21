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

/**
 * The SGS Score Workspace payload family — mirrors
 * src/types/sgs-score-workspace.ts's SgsScoreWorkspacePayload and
 * src/services/sgs-score-workspace-service.ts's own
 * validateSgsScoreWorkspacePayload EXACTLY, for the same
 * cannot-import-TS reason as the assignment-scoped validator above.
 * Deliberately a SEPARATE version/kind namespace from
 * SGS_BRIDGE_PAYLOAD_VERSION — see that TS file's own doc comment for
 * why the two payload families must never be confused with each other.
 * Dispatched by `validateAnySgsBridgePayload`'s `kind` check below, never
 * guessed from shape.
 */
export const SGS_SCORE_WORKSPACE_PAYLOAD_VERSION = 1
export const SGS_SCORE_WORKSPACE_PAYLOAD_KIND = 'sgs_score_workspace'

export function validateSgsScoreWorkspacePayload(raw) {
  const errors = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }
  const payload = raw

  if (payload.kind !== SGS_SCORE_WORKSPACE_PAYLOAD_KIND) {
    errors.push(`kind ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_PAYLOAD_KIND})`)
  }
  if (payload.version !== SGS_SCORE_WORKSPACE_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_PAYLOAD_VERSION})`)
  }

  function requireNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${fieldName} ต้องเป็นข้อความที่ไม่ว่าง`)
    }
  }

  const subject = payload.subject
  if (typeof subject !== 'object' || subject === null) {
    errors.push('subject ต้องเป็น object')
  } else {
    requireNonEmptyString(subject.id, 'subject.id')
    requireNonEmptyString(subject.name, 'subject.name')
  }

  const classroom = payload.classroom
  if (typeof classroom !== 'object' || classroom === null) {
    errors.push('classroom ต้องเป็น object')
  } else {
    requireNonEmptyString(classroom.id, 'classroom.id')
    requireNonEmptyString(classroom.name, 'classroom.name')
  }

  let targetColumnMaxScore = null
  const targetColumn = payload.targetColumn
  if (typeof targetColumn !== 'object' || targetColumn === null) {
    errors.push('targetColumn ต้องเป็น object')
  } else {
    requireNonEmptyString(targetColumn.key, 'targetColumn.key')
    requireNonEmptyString(targetColumn.label, 'targetColumn.label')
    if (typeof targetColumn.maxScore !== 'number' || !Number.isFinite(targetColumn.maxScore) || targetColumn.maxScore <= 0) {
      errors.push('targetColumn.maxScore ต้องเป็นตัวเลขมากกว่า 0')
    } else {
      targetColumnMaxScore = targetColumn.maxScore
    }
  }

  if (!Array.isArray(payload.students)) {
    errors.push('students ต้องเป็น array')
  } else {
    payload.students.forEach((row, index) => {
      if (typeof row !== 'object' || row === null) {
        errors.push(`students[${index}] ต้องเป็น object`)
        return
      }
      requireNonEmptyString(row.studentId, `students[${index}].studentId`)
      requireNonEmptyString(row.fullName, `students[${index}].fullName`)
      if (row.studentNumber !== null && typeof row.studentNumber !== 'number') {
        errors.push(`students[${index}].studentNumber ต้องเป็นตัวเลขหรือ null`)
      }
      if (row.studentCode !== null && typeof row.studentCode !== 'string') {
        errors.push(`students[${index}].studentCode ต้องเป็นข้อความหรือ null`)
      }
      if (typeof row.score !== 'number' || !Number.isFinite(row.score)) {
        errors.push(`students[${index}].score ต้องเป็นตัวเลข (ห้ามเป็น null)`)
      } else {
        if (row.score < 0) errors.push(`students[${index}].score ติดลบไม่ได้`)
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

/**
 * Dispatches to the right validator by the payload's explicit `kind`
 * field — NEVER guessed from shape. A payload with no `kind` at all is
 * the legacy assignment-scoped format (every payload built before this
 * field existed) — treated as `'assignment'` by default, never rejected
 * outright, so an already-downloaded v2 file keeps working.
 */
export function validateAnySgsBridgePayload(raw) {
  if (typeof raw === 'object' && raw !== null && raw.kind === SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND) {
    return { kind: SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND, validation: validateSgsScoreWorkspaceMultiPayload(raw) }
  }
  if (typeof raw === 'object' && raw !== null && raw.kind === SGS_SCORE_WORKSPACE_PAYLOAD_KIND) {
    return { kind: SGS_SCORE_WORKSPACE_PAYLOAD_KIND, validation: validateSgsScoreWorkspacePayload(raw) }
  }
  return { kind: 'assignment', validation: validateSgsBridgePayload(raw) }
}

/** The PRODUCTION multi-column payload family — several SGS score
 * columns plus each student's score PER COLUMN, sent in one run. Mirrors
 * the web app's own validateSgsScoreWorkspaceMultiPayload so a file this
 * extension accepts is exactly a file that app produces: `null` stays a
 * meaningful "no score entered" (never collapsed with a real 0), and
 * every score is checked against ITS OWN column's max. */
export const SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND = 'sgs_score_workspace_multi'
export const SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION = 1

export function validateSgsScoreWorkspaceMultiPayload(raw) {
  const errors = []
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }

  if (raw.kind !== SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND) {
    errors.push(`kind ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND})`)
  }
  if (raw.version !== SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION})`)
  }
  if (typeof raw.subject !== 'object' || raw.subject === null || typeof raw.subject.name !== 'string' || raw.subject.name.trim() === '') {
    errors.push('subject.name ต้องเป็นข้อความที่ไม่ว่าง')
  }
  if (typeof raw.classroom !== 'object' || raw.classroom === null || typeof raw.classroom.name !== 'string' || raw.classroom.name.trim() === '') {
    errors.push('classroom.name ต้องเป็นข้อความที่ไม่ว่าง')
  }

  const maxScoreByKey = new Map()
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) {
    errors.push('columns ต้องเป็น array และมีอย่างน้อย 1 คอลัมน์')
  } else {
    raw.columns.forEach((column, index) => {
      if (typeof column?.key !== 'string' || column.key.trim() === '') {
        errors.push(`columns[${index}].key ต้องเป็นข้อความที่ไม่ว่าง`)
        return
      }
      if (typeof column.label !== 'string' || column.label.trim() === '') {
        errors.push(`columns[${index}].label ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      if (typeof column.maxScore !== 'number' || !Number.isFinite(column.maxScore) || column.maxScore <= 0) {
        errors.push(`columns[${index}].maxScore ต้องเป็นตัวเลขมากกว่า 0`)
        return
      }
      if (maxScoreByKey.has(column.key)) {
        errors.push(`columns[${index}].key ซ้ำกับคอลัมน์อื่น (${column.key})`)
        return
      }
      maxScoreByKey.set(column.key, column.maxScore)
    })
  }

  if (!Array.isArray(raw.students)) {
    errors.push('students ต้องเป็น array')
  } else {
    raw.students.forEach((student, index) => {
      if (typeof student?.studentId !== 'string' || student.studentId.trim() === '') {
        errors.push(`students[${index}].studentId ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      if (typeof student?.fullName !== 'string' || student.fullName.trim() === '') {
        errors.push(`students[${index}].fullName ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      const scores = student?.scoresByColumnKey
      if (typeof scores !== 'object' || scores === null) {
        errors.push(`students[${index}].scoresByColumnKey ต้องเป็น object`)
        return
      }
      for (const [key, value] of Object.entries(scores)) {
        if (value === null) continue
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`students[${index}].scoresByColumnKey.${key} ต้องเป็นตัวเลขหรือ null`)
          continue
        }
        if (value < 0) {
          errors.push(`students[${index}].scoresByColumnKey.${key} ต้องไม่ติดลบ`)
          continue
        }
        const max = maxScoreByKey.get(key)
        if (max !== undefined && value > max) {
          errors.push(`students[${index}].scoresByColumnKey.${key} (${value}) เกินคะแนนเต็มของคอลัมน์ (${max})`)
        }
      }
    })
  }

  return { ok: errors.length === 0, errors }
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
