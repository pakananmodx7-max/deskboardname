import { Check, Construction } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { infoTitle, type DocumentInfoTopic } from './document-center-ui'
import { AUTOFILL_LABEL, OUTPUT_LABEL } from './document-templates'

/** Body of the dialog — exported for tests (renders without a portal). */
export function DocumentInfoBody({ topic, extra }: { topic: DocumentInfoTopic; extra?: React.ReactNode }) {
  if (topic.kind === 'upload') {
    return (
      <div className="space-y-2 text-sm text-foreground">
        <p>ตอนนี้การอัปโหลดไฟล์ทำได้ในหน้างานหรือบทเรียนของแต่ละรายวิชา (รายวิชา → เลือกห้องเรียน → งาน / บทเรียน) แล้วไฟล์จะแสดงในระบบเอกสารนี้โดยอัตโนมัติ</p>
        <p className="text-muted-foreground">การอัปโหลดเข้าระบบเอกสารโดยตรงจะเปิดให้ใช้ในเฟสถัดไป</p>
        {extra}
      </div>
    )
  }
  if (topic.kind === 'folder') {
    return (
      <div className="space-y-2 text-sm text-foreground">
        <p>การสร้างและจัดการโฟลเดอร์ของคุณเองจะเปิดให้ใช้ในเฟสถัดไป ตอนนี้ยังไม่มีการสร้างโฟลเดอร์ใด ๆ</p>
        <p className="text-muted-foreground">ระหว่างนี้ใช้หมวดหมู่ด้านบนและตัวกรองเพื่อค้นหาเอกสารได้</p>
      </div>
    )
  }
  const template = topic.kind === 'template' ? topic.template : null
  return (
    <div className="space-y-3 text-sm text-foreground">
      <p>
        การสร้างเอกสาร{template ? `“${template.title}”` : 'เปล่า'}อัตโนมัติจะเปิดให้ใช้ใน <span className="font-semibold">เฟส 2</span> —
        ตอนนี้ยังไม่มีการสร้างหรือบันทึกเอกสารใด ๆ
      </p>
      {template && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">สิ่งที่จะทำได้ในเฟส 2</p>
          <ul className="space-y-1">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>ดึงข้อมูลจากระบบอัตโนมัติ: {template.autofill.map((s) => AUTOFILL_LABEL[s]).join(', ')}</span>
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>แก้ไขเอกสารก่อนบันทึก และเก็บประวัติเวอร์ชัน</span>
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>ส่งออกเป็น {template.outputs.map((o) => OUTPUT_LABEL[o]).join(', ')}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

export function DocumentInfoDialog({ topic, onClose, extra }: { topic: DocumentInfoTopic | null; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <Dialog open={topic !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {topic && (
          <>
            <DialogHeader>
              <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-warning/20 text-orange-600" aria-hidden="true">
                <Construction className="size-5" />
              </span>
              <DialogTitle>{infoTitle(topic)}</DialogTitle>
              <DialogDescription>ระบบเอกสาร เฟส 1 — ส่วนนี้ยังไม่เปิดใช้งาน</DialogDescription>
            </DialogHeader>
            <DocumentInfoBody topic={topic} extra={extra} />
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                เข้าใจแล้ว
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
