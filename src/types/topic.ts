export interface Topic {
  id: string
  subjectId: string
  title: string
  description: string | null
  position: number
  taughtDate: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTopicInput {
  subjectId: string
  title: string
  description?: string | null
  position?: number
  taughtDate?: string | null
}

export interface UpdateTopicInput {
  title?: string
  description?: string | null
  position?: number
  taughtDate?: string | null
}
