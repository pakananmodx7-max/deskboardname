import { ClipboardList } from 'lucide-react'

import { PlaceholderPage } from '@/components/layout/placeholder-page'

export function AssignmentsPage() {
  return (
    <PlaceholderPage
      title="งานที่มอบหมาย"
      description="จัดการงาน ติดตามการส่งงาน และให้คะแนนจะพร้อมใช้งานในเฟสถัดไป"
      icon={ClipboardList}
    />
  )
}
