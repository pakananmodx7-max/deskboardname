/**
 * Document templates shown in "สร้างเอกสารจากแบบฟอร์ม". Phase 1 is UI
 * only: a template describes what it WILL produce (Phase 2) — nothing
 * here generates, saves or exports a document. `autofill` and `outputs`
 * are the contract the Phase 2 generator will implement.
 */

export type TemplateIcon = 'plan' | 'homeroom' | 'memo' | 'report' | 'roster'
export type TemplateAccent = 'blue' | 'purple' | 'green' | 'orange' | 'red'
/** Shape of the small paper illustration on the card. */
export type TemplatePreview = 'official' | 'form' | 'memo' | 'table' | 'list'

export type AutofillSource = 'teacher' | 'school' | 'classroom' | 'subject' | 'students' | 'attendance' | 'semester'

export const AUTOFILL_LABEL: Record<AutofillSource, string> = {
  teacher: 'ชื่อครูผู้สอน',
  school: 'ข้อมูลโรงเรียน',
  classroom: 'ห้องเรียน',
  subject: 'รายวิชา',
  students: 'รายชื่อนักเรียน',
  attendance: 'ข้อมูลการเข้าเรียน',
  semester: 'ปีการศึกษา / ภาคเรียน',
}

export interface DocumentTemplate {
  id: string
  title: string
  /** `title` split at natural Thai word boundaries, so a narrow card never
   * breaks inside a word (browsers do not know terms like "โฮมรูม"). */
  titleChunks: string[]
  description: string
  icon: TemplateIcon
  accent: TemplateAccent
  preview: TemplatePreview
  /** Data the Phase 2 generator will fill in from the system. */
  autofill: AutofillSource[]
  /** Planned output formats. */
  outputs: ('docx' | 'pdf' | 'google_drive')[]
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'lesson-plan',
    title: 'แผนการจัดการเรียนรู้',
    titleChunks: ['แผนการจัด', 'การเรียนรู้'],
    description: 'แบบฟอร์มแผนการจัดการเรียนรู้ตามหลักสูตร',
    icon: 'plan',
    accent: 'blue',
    preview: 'official',
    autofill: ['teacher', 'school', 'subject', 'classroom', 'semester'],
    outputs: ['docx', 'pdf', 'google_drive'],
  },
  {
    id: 'homeroom-log',
    title: 'แบบบันทึกกิจกรรมโฮมรูม',
    titleChunks: ['แบบบันทึก', 'กิจกรรม', 'โฮมรูม'],
    description: 'บันทึกกิจกรรมโฮมรูมและพัฒนาผู้เรียน',
    icon: 'homeroom',
    accent: 'purple',
    preview: 'form',
    autofill: ['teacher', 'classroom', 'students', 'attendance', 'semester'],
    outputs: ['docx', 'pdf', 'google_drive'],
  },
  {
    id: 'official-memo',
    title: 'บันทึกข้อความราชการ',
    titleChunks: ['บันทึก', 'ข้อความ', 'ราชการ'],
    description: 'แบบฟอร์มบันทึกข้อความทั่วไปตามระเบียบงานสารบรรณ',
    icon: 'memo',
    accent: 'green',
    preview: 'memo',
    autofill: ['teacher', 'school'],
    outputs: ['docx', 'pdf', 'google_drive'],
  },
  {
    id: 'activity-report',
    title: 'รายงานผลการจัดกิจกรรม',
    titleChunks: ['รายงานผล', 'การจัด', 'กิจกรรม'],
    description: 'สรุปผลการจัดกิจกรรมในชั้นเรียน',
    icon: 'report',
    accent: 'orange',
    preview: 'table',
    autofill: ['teacher', 'classroom', 'subject', 'attendance', 'semester'],
    outputs: ['docx', 'pdf', 'google_drive'],
  },
  {
    id: 'student-roster',
    title: 'แบบรายชื่อนักเรียน',
    titleChunks: ['แบบรายชื่อ', 'นักเรียน'],
    description: 'รายชื่อนักเรียนและข้อมูลประจำชั้น',
    icon: 'roster',
    accent: 'red',
    preview: 'list',
    autofill: ['classroom', 'students', 'semester'],
    outputs: ['docx', 'pdf', 'google_drive'],
  },
]

export const OUTPUT_LABEL: Record<DocumentTemplate['outputs'][number], string> = {
  docx: 'Word (.docx)',
  pdf: 'PDF',
  google_drive: 'บันทึกไป Google Drive',
}
