import { describe, expect, it } from 'vitest'

import { linkToRow, noteToRow, taskToRow, toTask } from './workspace-service'

describe('workspace-service row mapping', () => {
  it('never sends an owner id, and only the fields that changed', () => {
    expect(taskToRow({ title: '  งาน  ', dueDate: '2026-11-03', important: true })).toEqual({ title: 'งาน', due_date: '2026-11-03', important: true })
    expect(Object.keys(noteToRow({ body: 'x', tags: ['a'] }))).toEqual(['body', 'tags'])
    for (const row of [taskToRow({ title: 'x' }), noteToRow({ title: 'x' }), linkToRow({ title: 'x', url: 'https://a.example/' })]) {
      expect(row).not.toHaveProperty('owner_id')
      expect(row).not.toHaveProperty('completed_at')
      expect(row).not.toHaveProperty('revision')
    }
  })

  it('blank categories are stored as null', () => {
    expect(taskToRow({ category: '   ' })).toEqual({ category: null })
    expect(linkToRow({ category: ' เอกสาร ' })).toEqual({ category: 'เอกสาร' })
    expect(noteToRow({ category: null })).toEqual({ category: null })
  })

  it('reads date columns as calendar days', () => {
    const t = toTask({ id: 'a', title: 't', description: null, status: 'todo', priority: 'low', due_date: '2026-11-30', start_date: null, category: null, important: false, urgent: true, sort_order: 512.5, completed_at: null, created_at: 'c', updated_at: 'u' })
    expect(t.dueDate).toBe('2026-11-30')
    expect(t.description).toBe('')
    expect(t.sortOrder).toBe(512.5)
  })
})
