/**
 * Static, non-fabricated facts about the Hermes/Teacher Agent tool
 * surface, shared between the Home page's compact Hermes summary card
 * and the full Hermes Agent control center (hermes-agent-page.tsx) so
 * the tool list is described in exactly one place.
 *
 * These names/descriptions mirror mcp-bridge/src/tool-schemas.ts and the
 * deployed `teacher-agent-tools` Supabase Edge Function EXACTLY (5 read
 * + 3 write) — see mcp-bridge/README.md. This file does not call either
 * of them and never will from the browser: the MCP bridge is a LOCAL
 * stdio process that runs on the teacher's own machine, wired to Hermes
 * over stdio, not over the network — there is no URL this web app could
 * ever reach to ask "is Hermes online right now" or "is the bridge
 * connected." Anything claiming a live Online/Offline/Connected status
 * here would be fabricated, which the task this file was built for
 * explicitly forbids — see hermes-agent-page.tsx's own doc comment for
 * how that honesty constraint is presented to the teacher.
 */
export interface HermesToolInfo {
  name: string
  description: string
}

export const HERMES_READ_TOOLS: HermesToolInfo[] = [
  { name: 'list_classrooms', description: 'แสดงรายการห้องเรียนของครูผู้ใช้งาน' },
  { name: 'list_assignments', description: 'แสดงรายการงาน/การบ้านในห้องเรียนที่ระบุ' },
  { name: 'get_missing_submissions', description: 'แสดงรายชื่อนักเรียนที่ยังไม่ส่งงานที่ระบุ' },
  { name: 'get_classroom_summary', description: 'สรุปภาพรวมห้องเรียน (การเข้าเรียน งานค้าง คะแนน)' },
  { name: 'get_student_summary', description: 'สรุปภาพรวมของนักเรียนรายบุคคล' },
]

export const HERMES_WRITE_TOOLS: HermesToolInfo[] = [
  { name: 'create_assignment', description: 'สร้างงาน/การบ้านใหม่ในห้องเรียนที่ครูเป็นเจ้าของ' },
  { name: 'copy_assignment_to_classrooms', description: 'คัดลอกงานที่มีอยู่ไปยังห้องเรียนอื่นของครูคนเดียวกัน' },
  { name: 'mark_attendance_bulk', description: 'บันทึก/แก้ไขการเช็กชื่อของนักเรียนหลายคนในครั้งเดียว' },
]

export const HERMES_TOTAL_TOOL_COUNT = HERMES_READ_TOOLS.length + HERMES_WRITE_TOOLS.length
