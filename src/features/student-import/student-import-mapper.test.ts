import { describe, expect, it } from 'vitest'

import { autoDetectMapping, normalizeHeader, splitFullName } from '@/features/student-import/student-import-mapper'

describe('normalizeHeader', () => {
  it('strips whitespace, dashes, and dots so header variants converge', () => {
    expect(normalizeHeader('ชื่อ-นามสกุล')).toBe(normalizeHeader('ชื่อ นามสกุล'))
    expect(normalizeHeader('E-mail')).toBe(normalizeHeader('Email'))
  })
})

describe('autoDetectMapping', () => {
  it('detects common Thai headers', () => {
    const headers = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'อีเมล', 'เบอร์โทร']
    expect(autoDetectMapping(headers)).toEqual({
      number: 0,
      studentCode: 1,
      firstName: 2,
      lastName: 3,
      nickname: 4,
      email: 5,
      phone: 6,
    })
  })

  it('detects a combined full name column distinctly from a first-name-only column', () => {
    expect(autoDetectMapping(['ชื่อ-นามสกุล'])).toEqual({ fullName: 0 })
    expect(autoDetectMapping(['ชื่อ'])).toEqual({ firstName: 0 })
  })

  it('detects common English headers', () => {
    expect(autoDetectMapping(['Student Code', 'First Name', 'Last Name'])).toEqual({
      studentCode: 0,
      firstName: 1,
      lastName: 2,
    })
  })

  it('detects a "classroom" column (Google Sheets Integration, Section 1)', () => {
    expect(autoDetectMapping(['ชื่อ', 'นามสกุล', 'ห้องเรียน'])).toEqual({ firstName: 0, lastName: 1, classroom: 2 })
    expect(autoDetectMapping(['First Name', 'Last Name', 'Classroom'])).toEqual({ firstName: 0, lastName: 1, classroom: 2 })
  })

  it('ignores unrecognized headers and never assigns the same field twice', () => {
    const mapping = autoDetectMapping(['ชื่อ', 'หมายเหตุ', 'ชื่อ'])
    expect(mapping.firstName).toBe(0)
    expect(Object.keys(mapping)).toHaveLength(1)
  })
})

describe('splitFullName', () => {
  it('splits a simple space-separated Thai name confidently', () => {
    expect(splitFullName('สมชาย ใจดี')).toEqual({
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      ambiguous: false,
    })
  })

  it('strips honorific prefixes before splitting', () => {
    expect(splitFullName('เด็กชายสมชาย ใจดี')).toEqual({
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      ambiguous: false,
    })
  })

  it('joins remaining tokens into the last name when there are more than two', () => {
    expect(splitFullName('สมชาย ใจดี มาก')).toEqual({
      firstName: 'สมชาย',
      lastName: 'ใจดี มาก',
      ambiguous: false,
    })
  })

  it('falls back to hyphen splitting and flags it ambiguous', () => {
    expect(splitFullName('สมชาย-ใจดี')).toEqual({
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      ambiguous: true,
    })
  })

  it('flags a single unsplittable token as ambiguous', () => {
    expect(splitFullName('สมชาย')).toEqual({ firstName: 'สมชาย', lastName: '', ambiguous: true })
  })

  it('flags an empty value as ambiguous', () => {
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '', ambiguous: true })
  })
})
