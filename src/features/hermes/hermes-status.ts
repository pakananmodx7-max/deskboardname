/**
 * Static, non-fabricated facts about the Hermes/Teacher Agent tool
 * surface, shared between the Home page's compact Hermes summary card
 * and the full Hermes Agent control center (hermes-agent-page.tsx) so
 * the tool list is described in exactly one place.
 *
 * These names/descriptions mirror mcp-bridge/src/tool-schemas.ts and the
 * deployed `teacher-agent-tools` Supabase Edge Function EXACTLY (5 read
 * + 4 write) — see mcp-bridge/README.md. This file does not call either
 * of them and never will from the browser: the MCP bridge is a LOCAL
 * stdio process that runs on the teacher's own machine, wired to Hermes
 * over stdio, not over the network — there is no URL this web app could
 * ever reach to ask "is Hermes online right now" or "is the bridge
 * connected." Anything claiming a live Online/Offline/Connected status
 * here would be fabricated, which the task this file was built for
 * explicitly forbids — see hermes-agent-page.tsx's own doc comment for
 * how that honesty constraint is presented to the teacher.
 *
 * `label` is the human-facing capability name a teacher actually reads
 * (e.g. "เช็กชื่อ", "สร้างงาน", "คัดลอกงาน") — the prominent text
 * everywhere this list is shown. `name` is the raw MCP tool identifier
 * (e.g. `mark_attendance_bulk`) — kept only for a collapsed technical
 * disclosure, never the first thing a teacher reads (see the "no
 * technical identifiers in normal teacher-facing UI" UX finding).
 */
export interface HermesToolInfo {
  name: string
  label: string
  description: string
}

export const HERMES_READ_TOOLS: HermesToolInfo[] = [
  { name: 'list_classrooms', label: 'ดูรายชื่อห้องเรียน', description: 'แสดงรายการห้องเรียนของครูผู้ใช้งาน' },
  { name: 'list_assignments', label: 'ดูรายการงาน', description: 'แสดงรายการงาน/การบ้านในห้องเรียนที่ระบุ' },
  {
    name: 'get_missing_submissions',
    label: 'ดูรายชื่อนักเรียนที่ยังไม่ส่งงาน',
    description: 'แสดงรายชื่อนักเรียนที่ยังไม่ส่งงานที่ระบุ',
  },
  {
    name: 'get_classroom_summary',
    label: 'สรุปภาพรวมห้องเรียน',
    description: 'สรุปภาพรวมห้องเรียน (การเข้าเรียน งานค้าง คะแนน)',
  },
  { name: 'get_student_summary', label: 'สรุปภาพรวมนักเรียน', description: 'สรุปภาพรวมของนักเรียนรายบุคคล' },
]

export const HERMES_WRITE_TOOLS: HermesToolInfo[] = [
  { name: 'create_assignment', label: 'สร้างงาน', description: 'สร้างงาน/การบ้านใหม่ในห้องเรียนที่ครูเป็นเจ้าของ' },
  {
    name: 'copy_assignment_to_classrooms',
    label: 'คัดลอกงาน',
    description: 'คัดลอกงานที่มีอยู่ไปยังห้องเรียนอื่นของครูคนเดียวกัน',
  },
  {
    name: 'mark_attendance_bulk',
    label: 'เช็กชื่อ',
    description: 'บันทึก/แก้ไขการเช็กชื่อของนักเรียนหลายคนในครั้งเดียว',
  },
  {
    name: 'mark_submission_status',
    label: 'บันทึกสถานะการส่งงาน',
    description: 'ปรับสถานะการส่งงานของนักเรียนรายบุคคล (ส่งแล้ว/ส่งช้า/ขาดส่ง/ยังไม่ส่ง)',
  },
]

export const HERMES_TOTAL_TOOL_COUNT = HERMES_READ_TOOLS.length + HERMES_WRITE_TOOLS.length
