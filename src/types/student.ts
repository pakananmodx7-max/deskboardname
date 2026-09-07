export type StudentStatus = 'active' | 'inactive' | 'transferred'

export interface Student {
  id: string
  studentCode: string
  number: number
  firstName: string
  lastName: string
  classId: string
  status: StudentStatus
}
