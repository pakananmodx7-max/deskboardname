import { Bot, CheckCircle2, HelpCircle, Lock, ShieldCheck } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { HERMES_READ_TOOLS, HERMES_WRITE_TOOLS, type HermesToolInfo } from '@/features/hermes/hermes-status'

function CapabilityRow({ tool }: { tool: HermesToolInfo }) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <p className="font-medium">{tool.label}</p>
      <p className="mt-0.5 text-muted-foreground">{tool.description}</p>
    </div>
  )
}

/**
 * Requirement 5 (superseded AI Assistant): the AI Assistant demo chat
 * (ai-page.tsx, still reachable only by direct URL/old bookmark —
 * /teacher/ai now redirects here) is no longer this app's "AI" story.
 * This page does NOT build another chatbot — Telegram is the primary
 * conversational interface, this is only a Control Center describing
 * what Hermes can do and how safety is enforced.
 *
 * Requirement C4 (UX audit → implementation plan): a teacher never
 * needs to see a raw MCP tool identifier like `mark_attendance_bulk` —
 * every capability leads with its plain-language label (label prop on
 * HermesToolInfo); the technical identifier is available but tucked
 * behind a collapsed "รายละเอียดทางเทคนิค" disclosure, never the
 * prominent text. The 3 previously-repeated "cannot be checked from
 * here" status rows are now one sentence, and the quick-links card was
 * removed (it only repeated destinations already permanent in the
 * sidebar). No "เปิด Telegram" action is added here: there is no
 * Telegram bot handle/link anywhere in this codebase to point it at, so
 * per that constraint this page omits the action entirely rather than
 * invent or hardcode one — add it once a real link exists.
 *
 * Requirement 8 (honesty about activity): Hermes and its MCP bridge run
 * as a separate local process on the teacher's own machine (see
 * mcp-bridge/README.md) — this browser tab has no channel to ask either
 * one "are you online," and dashboard-service.ts's getRecentActivity()
 * cannot distinguish a Hermes-originated write from a normal in-app
 * action (there is no `source`/`actor` column anywhere in the schema
 * that records this). Rather than mislabel ordinary activity as
 * "Hermes activity," or invent a status, this page says plainly what
 * isn't knowable from here. No new backend/audit system was introduced
 * to make this page look more complete.
 */
export function HermesAgentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Hermes Agent</h1>
          <p className="text-sm text-muted-foreground">ศูนย์ควบคุมและตรวจสอบผู้ช่วยครู (Teacher Agent) ผ่าน MCP</p>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-start gap-2 pt-5 text-sm">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Hermes และ MCP bridge ทำงานเป็นโปรแกรมแยกต่างหากบนเครื่องของครูเอง ไม่ได้เชื่อมต่อกับเว็บแอปนี้โดยตรง
            หน้านี้จึงไม่สามารถรายงานสถานะ Agent, Telegram หรือ MCP bridge แบบเรียลไทม์ได้ — โปรดตรวจสอบสถานะจริงจากหน้าต่าง Hermes บนเครื่องของคุณ
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>สิ่งที่ Hermes ตอบได้ ({HERMES_READ_TOOLS.length})</CardTitle>
            <CardDescription>ไม่แก้ไขข้อมูลใด ๆ — ใช้ตอบคำถามและสรุปข้อมูลเท่านั้น</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {HERMES_READ_TOOLS.map((tool) => (
              <CapabilityRow key={tool.name} tool={tool} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>สิ่งที่ Hermes ทำแทนได้ ({HERMES_WRITE_TOOLS.length})</CardTitle>
            <CardDescription>แก้ไขข้อมูลจริงในระบบ — ทุกครั้งต้องได้รับการยืนยันก่อนทำงาน</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {HERMES_WRITE_TOOLS.map((tool) => (
              <CapabilityRow key={tool.name} tool={tool} />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ความปลอดภัยและการยืนยันก่อนทำงาน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <p>เครื่องมือเขียนข้อมูลทุกรายการถูกทำเครื่องหมายให้ต้องยืนยันก่อนทำงานเสมอ ไม่มีการลบข้อมูลใด ๆ ที่ทำได้</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0 text-success" />
            <p>Hermes เข้าถึงข้อมูลได้เฉพาะห้องเรียน/รายวิชาที่ครูบัญชีนั้นเป็นเจ้าของเท่านั้น (ตรวจสอบสิทธิ์ฝั่งเซิร์ฟเวอร์เสมอ)</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <p>หน้านี้ไม่แสดงและไม่จัดเก็บ API key, token, รหัสผ่าน หรือข้อมูลลับใด ๆ</p>
          </div>

          <Disclosure summary="รายละเอียดทางเทคนิค (ชื่อเครื่องมือ MCP)">
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {[...HERMES_READ_TOOLS, ...HERMES_WRITE_TOOLS].map((tool) => (
                <p key={tool.name} className="font-mono">
                  {tool.name}
                </p>
              ))}
            </div>
          </Disclosure>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>กิจกรรมล่าสุดของ Hermes</CardTitle>
          <CardDescription>ยังไม่มีระบบบันทึกกิจกรรมเฉพาะของ Hermes แยกจากกิจกรรมทั่วไปของระบบ</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            ไม่มีข้อมูลกิจกรรมที่ยืนยันได้ว่ามาจาก Hermes โดยเฉพาะ — จะไม่แสดงข้อมูลกิจกรรมทั่วไปมาแทนเพื่อป้องกันความเข้าใจผิด
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
