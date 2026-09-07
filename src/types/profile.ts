export type ProfileRole = 'teacher' | 'admin' | 'student'

export interface Profile {
  id: string
  displayName: string | null
  email: string | null
  role: ProfileRole
  createdAt: string
  updatedAt: string
}
