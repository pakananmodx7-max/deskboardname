import type {
  ActivityItem,
  AssignmentSummary,
  AtRiskStudent,
  AttendanceSummary,
  DashboardStats,
} from '@/types/dashboard'

export const mockDashboardStats: DashboardStats = {
  totalStudents: 38,
  presentToday: 34,
  attendanceRate: 89,
  missingAssignments: 27,
  studentsAtRisk: 5,
}

export const mockAttendanceSummary: AttendanceSummary = {
  present: 34,
  late: 1,
  leave: 1,
  absent: 2,
  total: 38,
}

export const mockAtRiskStudents: AtRiskStudent[] = [
  {
    id: 'std-001',
    name: 'สมชาย ใจดี',
    reasons: ['งานค้าง 4 งาน', 'ขาดเรียน 2 ครั้ง'],
    riskLevel: 'high',
  },
  {
    id: 'std-002',
    name: 'กิตติ พรชัย',
    reasons: ['คะแนนเฉลี่ยลดลง 12%'],
    riskLevel: 'medium',
  },
  {
    id: 'std-003',
    name: 'อริสา ทองดี',
    reasons: ['งานค้าง 2 งาน'],
    riskLevel: 'medium',
  },
]

export const mockAssignments: AssignmentSummary[] = [
  {
    id: 'asg-001',
    title: 'Project 2',
    dueDate: '10 Sep',
    submittedCount: 25,
    totalCount: 38,
  },
  {
    id: 'asg-002',
    title: 'Quiz Chapter 4',
    dueDate: '12 Sep',
    submittedCount: 31,
    totalCount: 38,
  },
  {
    id: 'asg-003',
    title: 'Homework 7',
    dueDate: '15 Sep',
    submittedCount: 18,
    totalCount: 38,
  },
]

export const mockRecentActivity: ActivityItem[] = [
  {
    id: 'act-001',
    timeLabel: '08:15',
    message: 'สมชายถูกบันทึกว่า "ขาดเรียน"',
  },
  {
    id: 'act-002',
    timeLabel: '08:03',
    message: 'กิตติส่ง Assignment 04',
  },
  {
    id: 'act-003',
    timeLabel: 'เมื่อวาน',
    message: 'คะแนน Quiz 03 ถูกอัปเดต',
  },
  {
    id: 'act-004',
    timeLabel: 'เมื่อวาน',
    message: 'ส่งการแจ้งเตือนให้นักเรียน 7 คน',
  },
]
