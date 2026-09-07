import { DEMO_STUDENTS } from '@/demo/students'
import type { DemoClassroomInfo, DemoStudent } from '@/demo/types'

const EXTRA_FIRST_NAMES = [
  'ณัฐพล', 'ชนิสรา', 'ปวริศ', 'เกวลิน', 'พงศกร', 'ศศิวิมล', 'ธีรเดช', 'อภิญญา',
  'วรากร', 'พิชญา', 'สิรวิชญ์', 'ภัทรวดี', 'ชยพล', 'กัญญาณัฐ', 'ปิยะพงษ์', 'ธมลวรรณ',
  'ศิวกร', 'นันท์นภัส', 'อัครวินท์', 'พรรณวษา', 'จักรภัทร', 'วิภาวี', 'ธนวัฒน์', 'สุพิชญา',
  'ปรัตถกร', 'ญาณิน', 'กิตติภูมิ', 'ชาลิสา', 'ณัฐดนัย', 'เขมิกา', 'ภูริณัฐ', 'มนัสนันท์',
  'วรัญญู', 'อรวรรยา', 'ธนบดี', 'ศุภิสรา', 'พีรวิชญ์',
]

const EXTRA_LAST_NAMES = [
  'มงคลชัย', 'พูนสิน', 'เจริญสุข', 'วัฒนกุล', 'ทรัพย์เจริญ', 'ศักดิ์สิทธิ์', 'บุญประเสริฐ',
  'ธนากร', 'สว่างจิต', 'รัตนไพศาล', 'เกียรติก้อง', 'ปัญญาดี', 'สุขเกษม', 'ใจกล้า',
  'พิพัฒน์กุล', 'แก้วมงคล', 'ทองสมบูรณ์', 'ชูเกียรติศักดิ์', 'อินทรทัต', 'โพธิ์ศรีทอง',
  'วิไลลักษณ์', 'ศรีประเสริฐ', 'บุญยืน', 'กาญจนสิริ', 'มีสุข', 'พรหมเมศร์', 'สายสมร',
  'จันทรัตน์', 'อ่อนละมัย', 'ดำรงพันธ์', 'สุนทรกิจ', 'เพิ่มพูน', 'ธาราทิพย์', 'ผ่องอำไพ',
  'รุ่งโรจน์กุล', 'สมานมิตร', 'หาญณรงค์',
]

function generateRoster(
  classroomName: string,
  idPrefix: string,
  count: number,
  studentCodeStart: number,
): DemoStudent[] {
  return Array.from({ length: count }, (_, index) => {
    const firstName = EXTRA_FIRST_NAMES[index % EXTRA_FIRST_NAMES.length]
    // Offset the last-name pick so first/last combinations don't repeat as the index wraps.
    const lastName = EXTRA_LAST_NAMES[(index + Math.floor(index / EXTRA_FIRST_NAMES.length) * 7) % EXTRA_LAST_NAMES.length]
    return {
      id: `${idPrefix}-${index + 1}`,
      number: index + 1,
      studentCode: String(studentCodeStart + index),
      firstName,
      lastName,
      nickname: firstName.slice(0, 2),
      classroom: classroomName,
      status: 'active' as const,
    }
  })
}

export const CLASSROOM_2_NAME = 'ม.5/2'
export const CLASSROOM_3_NAME = 'ม.5/3'

export const CLASSROOM_2_STUDENTS: DemoStudent[] = generateRoster(CLASSROOM_2_NAME, 'demo-c2-student', 35, 68001)
export const CLASSROOM_3_STUDENTS: DemoStudent[] = generateRoster(CLASSROOM_3_NAME, 'demo-c3-student', 37, 69001)

/**
 * All students across every classroom, keyed for the subject workspace.
 * ม.5/1 reuses the exact same DEMO_STUDENTS records used by the original
 * single-classroom demo (Dashboard/Students/Attendance/Assignments/Grades),
 * so a student referenced from a subject is the same entity everywhere.
 */
export const ALL_CLASSROOM_STUDENTS: DemoStudent[] = [
  ...DEMO_STUDENTS,
  ...CLASSROOM_2_STUDENTS,
  ...CLASSROOM_3_STUDENTS,
]

export function buildInitialClassrooms(): DemoClassroomInfo[] {
  return [
    { id: 'classroom-1', name: 'ม.5/1', studentIds: DEMO_STUDENTS.map((s) => s.id) },
    { id: 'classroom-2', name: CLASSROOM_2_NAME, studentIds: CLASSROOM_2_STUDENTS.map((s) => s.id) },
    { id: 'classroom-3', name: CLASSROOM_3_NAME, studentIds: CLASSROOM_3_STUDENTS.map((s) => s.id) },
  ]
}
