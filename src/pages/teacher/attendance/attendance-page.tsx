import { CalendarCheck } from 'lucide-react'

import { PlaceholderPage } from '@/components/layout/placeholder-page'

export function AttendancePage() {
  return (
    <PlaceholderPage
      title="เช็คชื่อนักเรียน"
      description="หน้าเช็คชื่อรายวันแบบเต็มรูปแบบจะพร้อมใช้งานในเฟสถัดไป"
      icon={CalendarCheck}
    />
  )
}
