import { DEMO_STUDENTS } from '@/demo/students'
import type { DemoAssignment } from '@/demo/types'

function buildSubmissions(notSubmittedIndexes: number[]): Record<string, boolean> {
  const notSubmitted = new Set(notSubmittedIndexes)
  const submissions: Record<string, boolean> = {}
  DEMO_STUDENTS.forEach((student, index) => {
    submissions[student.id] = !notSubmitted.has(index)
  })
  return submissions
}

export function buildInitialAssignments(): DemoAssignment[] {
  return [
    {
      id: 'demo-assignment-project-2',
      title: 'Project 2',
      dueDate: '10 Sep',
      submissions: buildSubmissions([0, 3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]),
    },
    {
      id: 'demo-assignment-quiz-4',
      title: 'Quiz Chapter 4',
      dueDate: '12 Sep',
      submissions: buildSubmissions([1, 4, 7, 10, 13, 16, 19]),
    },
    {
      id: 'demo-assignment-homework-7',
      title: 'Homework 7',
      dueDate: '15 Sep',
      submissions: buildSubmissions([
        2, 3, 6, 7, 9, 12, 13, 15, 18, 19, 21, 22, 24, 25, 27, 28, 30, 31, 33, 34,
      ]),
    },
  ]
}
