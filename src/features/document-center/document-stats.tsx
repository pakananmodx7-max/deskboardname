import { ArrowUp, CheckCircle2, Cloud, FileText, Folder, HardDrive, PenLine, type LucideIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import type { DocumentStatsData } from './document-center-model'
import { formatBytes } from './drive-storage-model'
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
  /** Folders in the KrunameClass Drive storage; null = storage not available. */
  folders?: number | null
}

/**
 * The four summary cards. Numbers only come from real rows; a card with
 * no data source (โฟลเดอร์ without Drive storage, ฉบับร่าง) shows "—" and
 * says why.
 */
export function DocumentStats({ stats, loading, drive, folders = null }: DocumentStatsProps) {
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
      <StatCard
        testId="stat-folders"
        icon={Folder}
        tone="orange"
        label="โฟลเดอร์"
        value={folders === null ? dash : String(folders)}
        loading={false}
        footnote={folders === null ? 'เชื่อมต่อ Google Drive เพื่อสร้างโฟลเดอร์' : 'ใน KrunameClass บน Google Drive'}
      />
      <StatCard testId="stat-drafts" icon={PenLine} tone="purple" label="ฉบับร่าง" value={dash} loading={false} footnote="ระบบสร้างเอกสารจะมาในเฟสถัดไป" />
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

/** Storage usage — only real numbers from Google Drive (about.storageQuota).
 * `quotaBytes` null = an account without a storage limit. */
export function StorageCard({ usage }: { usage: { usedBytes: number; quotaBytes: number | null } | null }) {
  const percent = usage && usage.quotaBytes && usage.quotaBytes > 0 ? Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100)) : null
  return (
    <section aria-label="พื้นที่จัดเก็บ" className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="storage-card">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/12 text-primary" aria-hidden="true">
          <HardDrive className="size-4.5" />
        </span>
        <h2 className="text-sm font-semibold">พื้นที่จัดเก็บ</h2>
      </div>
      {usage && percent !== null && usage.quotaBytes ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            ใช้ไป {formatBytes(usage.usedBytes)} จาก {formatBytes(usage.quotaBytes)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="พื้นที่ Google Drive ที่ใช้ไป">
              <div className={percent >= 90 ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'} style={{ width: `${Math.max(percent, 1)}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">พื้นที่ทั้งบัญชี Google (Drive, Gmail, Photos)</p>
        </div>
      ) : usage ? (
        <p className="mt-2 text-xs text-muted-foreground">ใช้ไป {formatBytes(usage.usedBytes)} (บัญชีนี้ไม่จำกัดพื้นที่)</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีข้อมูลพื้นที่จัดเก็บ</p>
      )}
    </section>
  )
}
