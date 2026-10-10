import { Cloud, CloudUpload, FolderPlus, History, Link2, Upload, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { formatDocumentDate, type DocumentActivity } from './document-center-model'
import { DocumentEmptyState } from './document-empty-state'

const ACTIVITY_STYLE: Record<DocumentActivity['kind'], { icon: LucideIcon; tone: string }> = {
  upload_file: { icon: Upload, tone: 'bg-primary/12 text-primary' },
  add_link: { icon: Link2, tone: 'bg-violet-500/15 text-violet-600' },
  add_drive: { icon: Cloud, tone: 'bg-orange-500/15 text-orange-600' },
  upload_drive: { icon: CloudUpload, tone: 'bg-emerald-500/15 text-emerald-600' },
  create_folder: { icon: FolderPlus, tone: 'bg-amber-500/15 text-orange-600' },
}

export interface DocumentActivityPanelProps {
  activity: DocumentActivity[]
  loading: boolean
  now: Date
}

/** Recent activity — only events that exist as real records (when a file
 * or link was added/uploaded, when a Drive folder was created).
 * Edit/share/delete history is not tracked. */
export function DocumentActivityPanel({ activity, loading, now }: DocumentActivityPanelProps) {
  return (
    <section aria-labelledby="document-activity-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 id="document-activity-title" className="text-sm font-semibold">
        การดำเนินการล่าสุด
      </h2>
      {loading ? (
        <ul className="mt-3 space-y-3" aria-label="กำลังโหลดกิจกรรม">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex gap-3">
              <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
              <span className="flex-1 space-y-1.5 pt-1">
                <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
                <span className="block h-3 w-4/5 animate-pulse rounded bg-muted" />
              </span>
            </li>
          ))}
        </ul>
      ) : activity.length === 0 ? (
        <DocumentEmptyState compact icon={History} title="ยังไม่มีประวัติกิจกรรม" description="เมื่อแนบไฟล์หรือลิงก์ในงานและบทเรียน รายการจะแสดงที่นี่" />
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border/70">
            {activity.map((a) => {
              const style = ACTIVITY_STYLE[a.kind]
              const Icon = style.icon
              return (
                <li key={a.id} className="flex gap-3 py-2.5">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', style.tone)} aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 text-xs">
                    <p className="text-sm font-semibold text-foreground">{a.label}</p>
                    <p className="line-clamp-2 text-muted-foreground">{a.documentTitle}</p>
                    {a.context && <p className="truncate text-muted-foreground/80">{a.context}</p>}
                    <p className="mt-0.5 text-muted-foreground">
                      <time dateTime={a.at}>{formatDocumentDate(a.at, now)}</time>
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">แสดงจากวันที่เพิ่มไฟล์และโฟลเดอร์จริง — ยังไม่มีการบันทึกประวัติการแก้ไข แชร์ หรือลบ</p>
        </>
      )}
    </section>
  )
}
