import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')

/**
 * Archived classrooms (เก็บถาวร) must not appear in active-classroom
 * workflows — each place that offers a classroom to pick filters them out.
 */
describe('archived classrooms stay out of active workflows', () => {
  it('subject↔classroom links carry the classroom archive state', () => {
    const service = read('../../services/subject-service.ts')
    expect(service).toContain("classrooms(name, is_active)")
    expect(service).toContain('classroomIsActive: row.classrooms?.is_active ?? true')
  })

  it.each([
    ['assignment copy targets', '../../services/assignment-service.ts', 'if (!link.classroomIsActive) continue'],
    ['lesson copy targets', '../../services/lesson-service.ts', 'if (!link.classroomIsActive) continue'],
    ['new assignment: other classrooms', '../subjects-real/assignment-dialog.tsx', 'links.filter((link) => link.classroomIsActive)'],
    ['new lesson: other classrooms', '../subjects-real/lesson-dialog.tsx', 'links.filter((link) => link.classroomIsActive)'],
    ['create subject: classroom picker', '../subjects-real/create-subject-dialog.tsx', 'rows.filter((c) => c.isActive)'],
    ['edit subject: only linked archived rooms shown', '../subjects-real/edit-subject-dialog.tsx', 'classrooms.filter((c) => c.isActive || linkedIds.has(c.id))'],
    ['move student targets', './tabs/classroom-students-tab.tsx', 'rows.filter((c) => c.isActive || c.id === classroom.id)'],
    ['students page classroom picker', '../../pages/teacher/students/students-page-real.tsx', 'all.filter((c) => c.isActive)'],
    ['subject list', '../../pages/teacher/subjects/subjects-page-real.tsx', '.filter((link) => link.classroomIsActive)'],
    ['subject classroom chooser', '../../pages/teacher/subjects/subject-detail-page-real.tsx', 'linkRows.filter((link) => link.classroomIsActive)'],
    ['workspace classroom switcher', '../../pages/teacher/subjects/subject-classroom-workspace-page-real.tsx', 'links.filter((link) => link.classroomIsActive || link.classroomId === activeClassroomId)'],
  ])('%s', (_label, path, needle) => {
    expect(read(path)).toContain(needle)
  })

  it('archived classrooms remain viewable: classroom list filter and detail page', () => {
    expect(read('../classroom-analytics/components/classroom-section.tsx')).toContain('<option value="archived">เก็บถาวร</option>')
    const detail = read('../../pages/teacher/classrooms/classroom-detail-page-real.tsx')
    expect(detail).toContain('ห้องนี้ถูกเก็บถาวร')
    expect(detail).toContain('กู้คืนห้องเรียน')
  })

  it('archive and permanent delete are separate, clearly named actions', () => {
    const section = read('../classroom-analytics/components/classroom-section.tsx')
    expect(section).toContain("label: 'เก็บถาวร / นำออกจากรายการห้องเรียน'")
    expect(section).toContain("label: 'กู้คืนห้องเรียน'")
    expect(section).toContain("label: 'ลบห้องเรียนถาวร'")
    // Permanent delete is offered only for archived classrooms.
    expect(section).toMatch(/card\.classroom\.isActive\s*\?\s*\[\]\s*:\s*\[\{ key: 'delete'/)
  })
})
