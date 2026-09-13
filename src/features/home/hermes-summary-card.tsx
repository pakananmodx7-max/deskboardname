import { Bot, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HERMES_TOTAL_TOOL_COUNT } from '@/features/hermes/hermes-status'

/** A short, human-readable sample of what Hermes can do — the same
 * canonical labels shown on the full Hermes Agent page (hermes-status.ts),
 * never a raw internal MCP tool identifier. */
const HERMES_SAMPLE_CAPABILITIES = ['เช็กชื่อ', 'สร้างงาน', 'สรุปภาพรวมห้องเรียน']

/**
 * The Home page's compact Hermes summary — deliberately says only what
 * is actually true and checkable from inside this web app: the fixed,
 * known tool count and a sample of human-readable capabilities. It NEVER
 * claims Online/Offline/Connected, because the Hermes agent and its MCP
 * bridge run outside this app entirely (a separate desktop process on the
 * teacher's own machine — see mcp-bridge/README.md) and there is no
 * channel for this browser tab to ask either one "are you up right now."
 * It also never invents a Telegram launch link: no bot handle/URL exists
 * anywhere in this codebase (see hermes-agent-page.tsx), so this card
 * says so plainly instead of adding a button that would go nowhere real.
 * See hermes-agent-page.tsx for the full explanation shown to the teacher.
 */
export function HermesSummaryCard() {
  return (
    <Link to="/teacher/hermes" className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="size-5" />
              </div>
              <CardTitle className="text-base">Hermes Agent</CardTitle>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {HERMES_SAMPLE_CAPABILITIES.map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            เครื่องมือที่พร้อมให้ Hermes ใช้งานทั้งหมด {HERMES_TOTAL_TOOL_COUNT} รายการ — สถานะการเชื่อมต่อจริง
            ตรวจสอบไม่ได้จากหน้านี้ เนื่องจาก Hermes ทำงานแยกต่างหากบนเครื่องของครูเอง
          </p>
          <p className="text-xs text-muted-foreground">ยังไม่ได้ตั้งค่าลิงก์ Telegram</p>
        </CardContent>
      </Card>
    </Link>
  )
}
