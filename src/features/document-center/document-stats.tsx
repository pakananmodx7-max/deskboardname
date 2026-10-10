import { ArrowUp, CheckCircle2, Cloud, FileText, Folder, HardDrive, PenLine, type LucideIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import type { DocumentStatsData } from './document-center-model'
import { driveStatusText, type DriveConnection } from './document-center-ui'

type Tone = 'blue' | 'orange' | 'purple' | 'green'

const TONE: Record<Tone, string> = {
  blue: 'bg-primary/12 text-primary',
  orange: 'bg-orange-500/15 text-orange-600',
  purple: 'bg-violet-500/15 text-violet-600',
  green: 'bg-emerald-500/15 text-emerald-600',
}

function StatCard({ icon: Icon, tone, label, value, footnote, loading, testId }: { icon: LucideIcon; tone: Tone; label: string; value: string; footnote: React.ReactNode; loading: boolean; testId: string }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-2xl border border-border bg-card p-3.5 shadow-sm sm:flex-row sm:items-center sm:gap-3.5 sm:p-4" data-testid={testId}>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full sm:size-12', TONE[tone])} aria-hidden="true">
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        {loading ? (
          <span className="block h-7 w-12 animate-pulse rounded bg-muted" />
        ) : (
          <p className="text-2xl font-bold leading-tight tabular-nums text-foreground">{value}</p>
        )}
        <p className="text-sm font-medium text-foreground/85">{label}</p>
        <div className="mt-0.5 text-xs text-muted-foreground">{footnote}</div>
      </div>
    </div>
  )
}

export interface DocumentStatsProps {
  stats: DocumentStatsData | null
  loading: boolean
  drive: DriveConnection
}

/**
 * The four summary cards. Numbers only come from real rows; cards with no
 * data source in Phase 1 (โฟลเดอร์, ฉบับร่าง) show "—" and say why.
 */
export function DocumentStats({ stats, loading, drive }: DocumentStatsProps) {
  const dash = '—'
  return (
    <section aria-label="สรุปเอกสาร" className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
      <StatCard
        testId="stat-documents"
        icon={FileText}
        tone="blue"
        label="เอกสารทั้งหมด"
        value={stats ? String(stats.total) : dash}
        loading={loading}
        footnote={
          stats && stats.addedThisMonth > 0 ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <ArrowUp className="size-3" aria-hidden="true" />
              {stats.addedThisMonth} รายการในเดือนนี้
            </span>
          ) : (
            'ไฟล์และลิงก์ในงานและบทเรียน'
          )
        }
      />
      <StatCard testId="stat-folders" icon={Folder} tone="orange" label="โฟลเดอร์" value={dash} loading={false} footnote="ยังไม่รองรับการสร้างโฟลเดอร์" />
      <StatCard testId="stat-drafts" icon={PenLine} tone="purple" label="ฉบับร่าง" value={dash} loading={false} footnote="ระบบสร้างเอกสารจะมาในเฟส 2" />
      <StatCard
        testId="stat-drive"
        icon={Cloud}
        tone="green"
        label="ไฟล์บน Google Drive"
        value={stats ? String(stats.inDrive) : dash}
        loading={loading}
        footnote={
          drive.status === 'connected' ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              เชื่อมต่อแล้ว
            </span>
          ) : (
            driveStatusText(drive)
          )
        }
      />
    </section>
  )
}

/** Storage usage — only with a real usage + quota (none in Phase 1). */
export function StorageCard({ usage }: { usage: { usedBytes: number; quotaBytes: number } | null }) {
  const percent = usage && usage.quotaBytes > 0 ? Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100)) : null
  return (
    <section aria-label="พื้นที่จัดเก็บ" className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="storage-card">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/12 text-primary" aria-hidden="true">
          <HardDrive className="size-4.5" />
        </span>
        <h2 className="text-sm font-semibold">พื้นที่จัดเก็บ</h2>
      </div>
      {usage && percent !== null ? (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="พื้นที่จัดเก็บที่ใช้ไป">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">ใช้ไป {percent}%</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีข้อมูลพื้นที่จัดเก็บ</p>
      )}
    </section>
  )
}
