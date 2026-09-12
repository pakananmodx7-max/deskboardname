import { Bot, CheckCircle2, HelpCircle, Lock, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HERMES_READ_TOOLS, HERMES_WRITE_TOOLS } from '@/features/hermes/hermes-status'

function StatusRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <HelpCircle className="size-3.5" />
        ไม่สามารถตรวจสอบได้จากหน้านี้
      </span>
    </div>
  )
}

/**
 * Requirement 5: the AI Assistant demo chat (ai-page.tsx, still reachable
 * only by direct URL/old bookmark — /teacher/ai now redirects here) is
 * no longer this app's "AI" story. This page does NOT build another
 * chatbot — it is an Agent Control Center: what Hermes/the Teacher Agent
 * CAN do (a fixed, real tool list mirrored from mcp-bridge/src/tool-schemas.ts
 * and the deployed teacher-agent-tools Edge Function) and how safety is
 * enforced, without ever claiming a live status this web app cannot
 * actually observe.
 *
 * Requirement 8 (honesty about activity): Hermes and its MCP bridge run
 * as a separate local process on the teacher's own machine (see
 * mcp-bridge/README.md) — this browser tab has no channel to ask either
 * one "are you online," and dashboard-service.ts's getRecentActivity()
 * cannot distinguish a Hermes-originated write from a normal in-app
 * action (there is no `source`/`actor` column anywhere in the schema
 * that records this). Rather than mislabel ordinary activity as
 * "Hermes activity," or invent a status, every section below says
 * plainly what is and isn't knowable from here. No new backend/audit
 * system was introduced to make this page look more complete.
 */
export function HermesAgentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Hermes Agent</h1>
          <p className="text-sm text-muted-foreground">ศูนย์ควบคุมและตรวจสอบผู้ช่วยครู (Teacher Agent) ผ่าน MCP</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>สถานะการเชื่อมต่อ</CardTitle>
          <CardDescription>
            Hermes และ MCP bridge ทำงานเป็นโปรแกรมแยกต่างหากบนเครื่องของครูเอง ไม่ได้เชื่อมต่อกับเว็บแอปนี้โดยตรง
            หน้านี้จึงไม่สามารถรายงานสถานะแบบเรียลไทม์ได้ — โปรดตรวจสอบสถานะจริงจากหน้าต่าง Hermes บนเครื่องของคุณ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatusRow label="Agent (Hermes)" />
          <StatusRow label="Telegram" />
          <StatusRow label="MCP bridge" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>เครื่องมืออ่านข้อมูล ({HERMES_READ_TOOLS.length})</CardTitle>
            <CardDescription>ไม่แก้ไขข้อมูลใด ๆ — ใช้ตอบคำถามและสรุปข้อมูลเท่านั้น</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {HERMES_READ_TOOLS.map((tool) => (
              <div key={tool.name} className="rounded-md border px-3 py-2 text-sm">
                <p className="font-mono text-xs font-semibold text-primary">{tool.name}</p>
                <p className="mt-0.5 text-muted-foreground">{tool.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>เครื่องมือเขียนข้อมูล ({HERMES_WRITE_TOOLS.length})</CardTitle>
            <CardDescription>แก้ไขข้อมูลจริงในระบบ — ทุกครั้งต้องได้รับการยืนยันก่อนทำงาน</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {HERMES_WRITE_TOOLS.map((tool) => (
              <div key={tool.name} className="rounded-md border px-3 py-2 text-sm">
                <p className="font-mono text-xs font-semibold text-primary">{tool.name}</p>
                <p className="mt-0.5 text-muted-foreground">{tool.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ความปลอดภัยและการยืนยันก่อนทำงาน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
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

      <Card>
        <CardHeader>
          <CardTitle>ทางลัด</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link
            to="/teacher/classroom-management"
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            ระบบจัดการชั้นเรียน
          </Link>
          <Link
            to="/teacher/students"
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            นักเรียน
          </Link>
          <Link
            to="/teacher/subjects"
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            รายวิชา
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
