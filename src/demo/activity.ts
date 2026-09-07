import type { DemoActivityItem } from '@/demo/types'

export function buildInitialActivity(): DemoActivityItem[] {
  return [
    { id: 'demo-activity-1', timeLabel: '08:15', message: 'สมชายถูกบันทึกว่า "ขาดเรียน"' },
    { id: 'demo-activity-2', timeLabel: '08:03', message: 'กิตติส่ง Assignment 04' },
    { id: 'demo-activity-3', timeLabel: 'เมื่อวาน', message: 'คะแนน Quiz 03 ถูกอัปเดต' },
    { id: 'demo-activity-4', timeLabel: 'เมื่อวาน', message: 'ส่งการแจ้งเตือนให้นักเรียน 7 คน' },
  ]
}
