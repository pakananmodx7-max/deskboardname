import type { DemoStudent } from '@/demo/types'

const CLASSROOM = 'ม.5/1'

const ROSTER: [string, string, string][] = [
  ['สมชาย', 'ใจดี', 'ชาย'],
  ['กิตติ', 'พรชัย', 'ตี้'],
  ['อริสา', 'ทองดี', 'ริน'],
  ['ปิยะดา', 'แสงจันทร์', 'ปิว'],
  ['ธนกร', 'ศรีสุข', 'กร'],
  ['วราภรณ์', 'บุญมี', 'วา'],
  ['ณัฐวุฒิ', 'เพชรรัตน์', 'นัท'],
  ['สุพัตรา', 'มั่นคง', 'พัด'],
  ['จิรายุ', 'รุ่งเรือง', 'จิ'],
  ['เบญจวรรณ', 'ศิริพร', 'เบญ'],
  ['ภานุวัฒน์', 'คงเจริญ', 'ภาน'],
  ['ชลธิชา', 'อ่อนน้อม', 'ชล'],
  ['ปรัชญา', 'วงศ์ษา', 'ปั้น'],
  ['กมลชนก', 'แก้วมณี', 'มล'],
  ['ธีรภัทร', 'สายทอง', 'ธี'],
  ['นภัสสร', 'บัวขาว', 'นะ'],
  ['วิชญ์พล', 'เรืองศรี', 'วิช'],
  ['สิริยากร', 'พงษ์พันธ์', 'สิริ'],
  ['อนุชา', 'ทิพย์วงศ์', 'ชา'],
  ['ปณิดา', 'เกษมสุข', 'ปุ๊',],
  ['ศุภกิจ', 'อินทร์แก้ว', 'ศุภ'],
  ['ณัฏฐณิชา', 'จันทร์เพ็ญ', 'ณิชา'],
  ['กรวิชญ์', 'หาญกล้า', 'กรวิ'],
  ['พิมพ์ชนก', 'สุขสวัสดิ์', 'พิม'],
  ['ธนภัทร', 'โพธิ์ทอง', 'ภัทร'],
  ['อัจฉรา', 'นาคสุข', 'อัจ'],
  ['ปพนธีร์', 'ชัยมงคล', 'พน'],
  ['ลลิตา', 'รัตนพันธ์', 'ลลิ'],
  ['เจษฎา', 'แก้วสุวรรณ', 'เจษ'],
  ['ฐิติมา', 'ผ่องใส', 'ติ๋ม'],
  ['วัชรพล', 'สมบูรณ์', 'วัช'],
  ['ญาณิศา', 'บุญเรือง', 'ญา'],
  ['ณรงค์ฤทธิ์', 'ศรีวิชัย', 'ฤทธิ์'],
  ['ปาริชาต', 'เมืองแก้ว', 'ชาต'],
  ['สรวิชญ์', 'ทองสุข', 'สร'],
  ['นันทิกานต์', 'พูลสวัสดิ์', 'นันท์'],
  ['อธิป', 'ยิ่งยง', 'ทิป'],
  ['เมธาวี', 'สว่างวงศ์', 'เมย์'],
]

export const DEMO_CLASSROOM_NAME = CLASSROOM

export const DEMO_STUDENTS: DemoStudent[] = ROSTER.map(([firstName, lastName, nickname], index) => ({
  id: `demo-student-${index + 1}`,
  number: index + 1,
  studentCode: `670${String(index + 1).padStart(2, '0')}`,
  firstName,
  lastName,
  nickname,
  classroom: CLASSROOM,
  status: 'active',
}))

/** Stand-in for a parsed Excel/CSV file in the "ใช้ข้อมูลตัวอย่าง" demo import flow. */
export const SAMPLE_IMPORT_ROWS: { studentCode: string; firstName: string; lastName: string; nickname: string }[] = [
  { studentCode: '67039', firstName: 'พีรพัฒน์', lastName: 'ชูเกียรติ', nickname: 'พี' },
  { studentCode: '67040', firstName: 'สุชานาถ', lastName: 'ดวงแก้ว', nickname: 'นาถ' },
  { studentCode: '67041', firstName: 'กันตพงศ์', lastName: 'อุ่นเรือน', nickname: 'กันต์' },
  { studentCode: '67042', firstName: 'ธัญชนก', lastName: 'ศรีทอง', nickname: 'ธัญ' },
  { studentCode: '67043', firstName: 'นราวิชญ์', lastName: 'พิทักษ์', nickname: 'นรา' },
]
