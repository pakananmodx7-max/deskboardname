import { mockStudents } from '@/data/student-mock'
import type { Student } from '@/types/student'

export async function getStudents(): Promise<Student[]> {
  return mockStudents
}
