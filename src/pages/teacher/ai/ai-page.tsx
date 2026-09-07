import { Bot } from 'lucide-react'

import { PlaceholderPage } from '@/components/layout/placeholder-page'

export function AiPage() {
  return (
    <PlaceholderPage
      title="AI Assistant"
      description="ผู้ช่วย AI แบบเต็มรูปแบบพร้อมการเชื่อมต่อ LLM จะพร้อมใช้งานในเฟสถัดไป"
      icon={Bot}
    />
  )
}
