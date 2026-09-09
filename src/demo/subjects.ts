import type {
  DemoLesson,
  DemoSubject,
  DemoSubjectAssignment,
  DemoSubmission,
  DemoTopic,
  SubmissionStatus,
} from '@/demo/types'

function buildSubmissions(
  studentIds: string[],
  maxScore: number,
  seedOffset: number,
): Record<string, DemoSubmission> {
  const result: Record<string, DemoSubmission> = {}

  studentIds.forEach((id, index) => {
    const bucket = (index + seedOffset) % 10
    let status: SubmissionStatus
    if (bucket < 7) status = 'submitted'
    else if (bucket < 8) status = 'late'
    else if (bucket === 8) status = 'not_submitted'
    else status = 'missing'

    let score: number | null = null
    if (status === 'submitted') {
      const ratio = 0.6 + ((index * 7 + seedOffset) % 40) / 100
      score = Math.round(ratio * maxScore)
    } else if (status === 'late') {
      const ratio = 0.4 + ((index * 5 + seedOffset) % 30) / 100
      score = Math.round(ratio * maxScore)
    }

    result[id] = { status, score, note: '' }
  })

  return result
}

export function buildInitialSubjects(): DemoSubject[] {
  return [
    {
      id: 'subject-science',
      name: 'วิทยาศาสตร์',
      code: 'ว32101',
      academicYear: '2569',
      semester: '1',
      description: 'รายวิชาวิทยาศาสตร์พื้นฐาน ชั้นมัธยมศึกษาปีที่ 5',
      classroomIds: ['classroom-1', 'classroom-2'],
    },
    {
      id: 'subject-math',
      name: 'คณิตศาสตร์',
      code: 'ค32101',
      academicYear: '2569',
      semester: '1',
      description: 'รายวิชาคณิตศาสตร์พื้นฐาน ชั้นมัธยมศึกษาปีที่ 5',
      classroomIds: ['classroom-1'],
    },
  ]
}

export function buildInitialTopics(): DemoTopic[] {
  return [
    {
      id: 'topic-sci-1',
      subjectId: 'subject-science',
      title: 'บทที่ 1 แรงและการเคลื่อนที่',
      description: 'แนวคิดพื้นฐานเรื่องแรง มวล และการเคลื่อนที่ของวัตถุ',
      order: 1,
      taughtDate: '2026-06-02',
    },
    {
      id: 'topic-sci-2',
      subjectId: 'subject-science',
      title: 'บทที่ 2 งานและพลังงาน',
      description: 'ความสัมพันธ์ระหว่างงาน พลังงานจลน์ และพลังงานศักย์',
      order: 2,
      taughtDate: '2026-06-16',
    },
    {
      id: 'topic-sci-3',
      subjectId: 'subject-science',
      title: 'บทที่ 3 โมเมนตัม',
      description: 'โมเมนตัมและการดลของแรง การชนแบบยืดหยุ่นและไม่ยืดหยุ่น',
      order: 3,
      taughtDate: '2026-06-30',
    },
    {
      id: 'topic-math-1',
      subjectId: 'subject-math',
      title: 'บทที่ 1 ฟังก์ชัน',
      description: 'ฟังก์ชันและกราฟของฟังก์ชัน',
      order: 1,
      taughtDate: '2026-06-03',
    },
    {
      id: 'topic-math-2',
      subjectId: 'subject-math',
      title: 'บทที่ 2 เรขาคณิตวิเคราะห์',
      description: 'ระยะทาง จุดกึ่งกลาง และสมการเส้นตรง',
      order: 2,
      taughtDate: '2026-06-24',
    },
  ]
}

/**
 * Each of subject-science's two linked classrooms (classroom-1 = ม.5/1,
 * classroom-2 = ม.5/2) gets its OWN independent assignment set — never a
 * merged subject-wide list. classroom-1 keeps the fuller original set;
 * classroom-2 deliberately includes an assignment with the SAME title as
 * one of classroom-1's ("ใบงานเรื่องแรง") to demonstrate that they are
 * two completely separate rows, not a shared "subject assignment" a
 * title collision would otherwise imply.
 */
export function buildInitialSubjectAssignments(studentIdsByClassroomIds: (classroomIds: string[]) => string[]): DemoSubjectAssignment[] {
  const scienceClassroom1Students = studentIdsByClassroomIds(['classroom-1'])
  const scienceClassroom2Students = studentIdsByClassroomIds(['classroom-2'])
  const mathStudents = studentIdsByClassroomIds(['classroom-1'])

  return [
    {
      id: 'sci-assign-1',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: 'topic-sci-1',
      title: 'ใบงานเรื่องแรง',
      type: 'worksheet',
      maxScore: 10,
      dueDate: '2026-09-15',
      description: 'ตอบคำถามเกี่ยวกับแรงลัพธ์และกฎการเคลื่อนที่ของนิวตัน',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 10, 1),
    },
    {
      id: 'sci-assign-2',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: 'topic-sci-1',
      title: 'Quiz บทที่ 1',
      type: 'quiz',
      maxScore: 10,
      dueDate: '2026-09-18',
      description: 'แบบทดสอบย่อยเรื่องแรงและการเคลื่อนที่',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 10, 3),
    },
    {
      id: 'sci-assign-3',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: 'topic-sci-2',
      title: 'การบ้านเรื่องงานและพลังงาน',
      type: 'homework',
      maxScore: 10,
      dueDate: '2026-09-25',
      description: 'โจทย์คำนวณงานและพลังงานจลน์',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 10, 5),
    },
    {
      id: 'sci-assign-4',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: 'topic-sci-3',
      title: 'แบบฝึกหัดโมเมนตัม',
      type: 'exercise',
      maxScore: 10,
      dueDate: '2026-10-05',
      description: 'โจทย์การอนุรักษ์โมเมนตัมและการชน',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 10, 7),
    },
    {
      id: 'sci-assign-5',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: 'topic-sci-3',
      title: 'Quiz บทที่ 2-3',
      type: 'quiz',
      maxScore: 20,
      dueDate: '2026-10-10',
      description: 'แบบทดสอบรวมเรื่องงาน พลังงาน และโมเมนตัม',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 20, 2),
    },
    {
      id: 'sci-assign-6',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      topicId: null,
      title: 'Project วิทยาศาสตร์ประยุกต์',
      type: 'project',
      maxScore: 30,
      dueDate: '2026-10-20',
      description: 'โครงงานประยุกต์ใช้แนวคิดฟิสิกส์ในชีวิตประจำวัน',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom1Students, 30, 9),
    },
    {
      id: 'sci-assign-7',
      subjectId: 'subject-science',
      classroomId: 'classroom-2',
      topicId: 'topic-sci-1',
      title: 'ใบงานเรื่องแรง',
      type: 'worksheet',
      maxScore: 10,
      dueDate: '2026-09-16',
      description: 'ตอบคำถามเกี่ยวกับแรงลัพธ์และกฎการเคลื่อนที่ของนิวตัน (ม.5/2)',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom2Students, 10, 2),
    },
    {
      id: 'sci-assign-8',
      subjectId: 'subject-science',
      classroomId: 'classroom-2',
      topicId: null,
      title: 'Project วิทยาศาสตร์ประยุกต์',
      type: 'project',
      maxScore: 30,
      dueDate: '2026-10-22',
      description: 'โครงงานประยุกต์ใช้แนวคิดฟิสิกส์ในชีวิตประจำวัน (ม.5/2)',
      isArchived: false,
      submissions: buildSubmissions(scienceClassroom2Students, 30, 4),
    },
    {
      id: 'math-assign-1',
      subjectId: 'subject-math',
      classroomId: 'classroom-1',
      topicId: 'topic-math-1',
      title: 'แบบฝึกหัดฟังก์ชัน',
      type: 'exercise',
      maxScore: 10,
      dueDate: '2026-09-12',
      description: 'โจทย์ฟังก์ชันและโดเมน-เรนจ์',
      isArchived: false,
      submissions: buildSubmissions(mathStudents, 10, 1),
    },
    {
      id: 'math-assign-2',
      subjectId: 'subject-math',
      classroomId: 'classroom-1',
      topicId: 'topic-math-1',
      title: 'การบ้านบทที่ 1',
      type: 'homework',
      maxScore: 10,
      dueDate: '2026-09-20',
      description: 'โจทย์กราฟของฟังก์ชัน',
      isArchived: false,
      submissions: buildSubmissions(mathStudents, 10, 4),
    },
    {
      id: 'math-assign-3',
      subjectId: 'subject-math',
      classroomId: 'classroom-1',
      topicId: 'topic-math-2',
      title: 'Quiz เรขาคณิต',
      type: 'quiz',
      maxScore: 10,
      dueDate: '2026-10-03',
      description: 'แบบทดสอบย่อยเรื่องระยะทางและสมการเส้นตรง',
      isArchived: false,
      submissions: buildSubmissions(mathStudents, 10, 6),
    },
    {
      id: 'math-assign-4',
      subjectId: 'subject-math',
      classroomId: 'classroom-1',
      topicId: null,
      title: 'โครงงานคณิตศาสตร์',
      type: 'project',
      maxScore: 20,
      dueDate: '2026-10-25',
      description: 'โครงงานประยุกต์คณิตศาสตร์กับชีวิตประจำวัน',
      isArchived: false,
      submissions: buildSubmissions(mathStudents, 20, 8),
    },
  ]
}

/**
 * Demo mirror of บทเรียน — two published lessons for subject-science's
 * classroom-1 (matching the feature spec's own example titles), plus one
 * unpublished draft to demonstrate the publish/draft distinction. See
 * DemoLesson's own comment for why this does NOT also seed any
 * per-lesson resources.
 */
export function buildInitialLessons(): DemoLesson[] {
  return [
    {
      id: 'sci-lesson-1',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      title: 'บทที่ 1 แรงและการเคลื่อนที่',
      description: 'แนวคิดพื้นฐานเรื่องแรง มวล และความเร่ง',
      order: 0,
      isPublished: true,
      isArchived: false,
    },
    {
      id: 'sci-lesson-2',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      title: 'บทที่ 2 กฎของนิวตัน',
      description: 'กฎการเคลื่อนที่ 3 ข้อของนิวตันและการประยุกต์ใช้',
      order: 1,
      isPublished: true,
      isArchived: false,
    },
    {
      id: 'sci-lesson-3',
      subjectId: 'subject-science',
      classroomId: 'classroom-1',
      title: 'บทที่ 3 งานและพลังงาน',
      description: 'ยังอยู่ระหว่างจัดเตรียมเนื้อหา',
      order: 2,
      isPublished: false,
      isArchived: false,
    },
  ]
}
