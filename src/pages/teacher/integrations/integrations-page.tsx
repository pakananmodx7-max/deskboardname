import { Plug } from 'lucide-react'

import { PlaceholderPage } from '@/components/layout/placeholder-page'

export function IntegrationsPage() {
  return (
    <PlaceholderPage
      title="การเชื่อมต่อระบบ"
      description="การตั้งค่า Supabase, Google Sheets, LINE และ Hermes Agent จะพร้อมใช้งานในเฟสถัดไป"
      icon={Plug}
    />
  )
}
