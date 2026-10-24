import { AlertTriangle, ArrowRight, BarChart3, ShieldCheck, TrendingUp, UserX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  ANALYTICS_RULES,
  RISK_LEVEL_LABEL,
  type AnalyticsClassroom,
  type AttendanceBreakdown,
  type AttendanceUnit,
  type Ranked,
  type RiskEntry,
  type StudentAttendanceStat,
  type WeeklyAttendancePoint,
} from '../analytics'
import { formatCount, formatPercent, type Resource } from '../resource'
import { AnalyticsCard, SectionBody, SectionEmpty, SectionIllustratedEmpty } from './analytics-card'
import { AnalyticsDonut, WeeklyAttendanceChart } from './charts'
import { AttendanceEmptyArt, TrendEmptyArt } from './dashboard-decor'

export type StudentLinkBuilder = (stat: StudentAttendanceStat) => string | null

/** Attendance is taken in each subject's เช็คชื่อ tab; /teacher/attendance
 * only redirects here (see attendance-redirect.ts). */
const ATTENDANCE_WORKFLOW_PATH = '/teacher/subjects'

// ==================================================
// Attendance overview donut
// ==================================================

export function AttendanceOverviewCard({
  resource,
  unit,
  onRetry,
}: {
  resource: Resource<AttendanceBreakdown>
  unit: AttendanceUnit
  onRetry: () => void
}) {
  return (
    <AnalyticsCard title="ภาพรวมการเข้าเรียน (ทุกห้องเรียน)" icon={BarChart3}>
      <SectionBody resource={resource} onRetry={onRetry} skeleton="chart">
        {(b) =>
          b.total === 0 ? (
            <SectionIllustratedEmpty
              art={<AttendanceEmptyArt />}
              message="ยังไม่มีบันทึกการเช็คชื่อในภาคเรียนนี้"
              hint="เมื่อเช็คชื่อในห้องเรียนหรือรายวิชา ข้อมูลจะแสดงที่นี่"
              action={
                <Link to={ATTENDANCE_WORKFLOW_PATH} className={cn(buttonVariants({ size: 'sm' }), 'rounded-full px-4')}>
                  ไปเช็คชื่อในรายวิชา
                  <ArrowRight className="size-4" />
                </Link>
              }
            />
          ) : (
            <>
              <AnalyticsDonut
                centerValue={formatPercent(b.rate)}
                centerLabel="อัตรามาเรียน"
                centerHint="นับเฉพาะสถานะ “มา”"
                unit="รายการ"
                slices={[
                  { key: 'present', label: 'มาเรียน', value: b.present, stroke: 'stroke-success', dot: 'bg-success' },
                  { key: 'late', label: 'มาสาย', value: b.late, stroke: 'stroke-warning', dot: 'bg-warning' },
                  { key: 'leave', label: 'ลา (ลากิจ/ลาป่วย)', value: b.leave, stroke: 'stroke-muted-foreground', dot: 'bg-muted-foreground' },
                  { key: 'absent', label: 'ขาดเรียน', value: b.absent, stroke: 'stroke-destructive', dot: 'bg-destructive' },
                ]}
              />
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                จากบันทึกการเช็คชื่อ {formatCount(b.total)} รายการ ({formatCount(b.sessions)} รอบเช็คชื่อ · นักเรียน {formatCount(b.studentsWithRecords)} คน) — 1 รายการ = นักเรียน 1 คนใน 1{' '}
                {unit === 'ครั้ง' ? 'รอบเช็คชื่อ' : unit}
              </p>
            </>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}

// ==================================================
// Weekly trend
// ==================================================

export function WeeklyTrendCard({
  resource,
  classrooms,
  classroomId,
  onClassroomChange,
  onRetry,
}: {
  resource: Resource<WeeklyAttendancePoint[]>
  classrooms: AnalyticsClassroom[]
  classroomId: string | null
  onClassroomChange: (id: string | null) => void
  onRetry: () => void
}) {
  return (
    <AnalyticsCard
      title="แนวโน้มการเข้าเรียนรายสัปดาห์"
      icon={TrendingUp}
      action={
        <NativeSelect
          value={classroomId ?? ''}
          onChange={(e) => onClassroomChange(e.target.value || null)}
          aria-label="เลือกห้องเรียนสำหรับกราฟแนวโน้ม"
          className="h-9 w-auto max-w-[170px] rounded-full px-3.5 text-xs"
        >
          <option value="">ทุกห้องเรียน</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      }
    >
      <SectionBody resource={resource} onRetry={onRetry} skeleton="chart">
        {(points) =>
          points.length === 0 ? (
            <SectionIllustratedEmpty
              art={<TrendEmptyArt />}
              message="ยังไม่มีบันทึกการเช็คชื่อสำหรับแสดงแนวโน้ม"
              hint={classroomId ? 'ลองเลือก “ทุกห้องเรียน”' : 'เมื่อมีข้อมูลการเช็คชื่อ ระบบจะแสดงกราฟแนวโน้มรายสัปดาห์ที่นี่'}
            />
          ) : (
            <>
              <WeeklyAttendanceChart points={points} />
              <p className="mt-2 text-xs text-muted-foreground">
                อัตรามาเรียน = มา ÷ รายการเช็คชื่อในสัปดาห์นั้น · สัปดาห์ที่ไม่มีการเช็คชื่อจะเว้นว่างในกราฟ
              </p>
            </>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}

// ==================================================
// Rankings
// ==================================================

function RankBadge({ rank, tone }: { rank: number; tone: 'red' | 'green' | 'orange' }) {
  const color = tone === 'red' ? 'bg-destructive text-white' : tone === 'green' ? 'bg-success text-white' : 'bg-warning text-warning-foreground'
  return (
    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', rank <= 3 ? color : 'bg-muted text-foreground')}>
      {rank}
    </span>
  )
}

function StudentName({ stat, link }: { stat: StudentAttendanceStat; link: StudentLinkBuilder | undefined }) {
  const href = link?.(stat) ?? null
  return (
    <div className="min-w-0 flex-1">
      {href ? (
        <Link to={href} className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline" title="ดูการวิเคราะห์รายบุคคล">
          {stat.fullName}
        </Link>
      ) : (
        <p className="truncate text-sm font-medium text-foreground">{stat.fullName}</p>
      )}
      <p className="truncate text-xs text-muted-foreground">{stat.classroomName}</p>
    </div>
  )
}

/** First consonant of the given name — skips a title (ด.ช./นาย...) and a
 * Thai leading vowel (เ แ โ ใ ไ), so "เกศินี" shows "ก". */
function nameInitial(name: string): string {
  const given = name.replace(/^(ด\.ช\.|ด\.ญ\.|นางสาว|นาย|นาง)\s*/, '')
  return Array.from(given).find((ch) => !/[\u0E40-\u0E44\s]/.test(ch)) ?? '?'
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
      {nameInitial(name)}
    </span>
  )
}

function Pill({ tone, children }: { tone: 'red' | 'green' | 'orange'; children: ReactNode }) {
  const color =
    tone === 'red' ? 'bg-destructive/10 text-destructive' : tone === 'green' ? 'bg-success/12 text-success' : 'bg-warning/20 text-warning-foreground'
  return <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums', color)}>{children}</span>
}

const REPORTS_PATH = '/teacher/reports'

export function MostAbsencesCard({
  resource,
  unit,
  link,
  onRetry,
}: {
  resource: Resource<Ranked<StudentAttendanceStat>[]>
  unit: AttendanceUnit
  link?: StudentLinkBuilder
  onRetry: () => void
}) {
  return (
    <AnalyticsCard
      title="นักเรียนที่ขาดเรียนมากที่สุด"
      icon={UserX}
      action={
        <Link to={REPORTS_PATH} className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent">
          ดูรายงาน <ArrowRight className="size-3" />
        </Link>
      }
    >
      <SectionBody resource={resource} onRetry={onRetry} skeleton="list">
        {(rows) =>
          rows.length === 0 ? (
            <SectionEmpty message="ยังไม่มีนักเรียนที่ขาดเรียน" />
          ) : (
            <ol className="space-y-2.5">
              {rows.map(({ rank, item }) => (
                <li key={item.studentId} className="flex items-center gap-2.5">
                  <RankBadge rank={rank} tone="red" />
                  <Avatar name={item.fullName} />
                  <StudentName stat={item} link={link} />
                  <Pill tone="red">
                    ขาด {item.absent} {unit}
                  </Pill>
                </li>
              ))}
            </ol>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}

export function TopAttendanceCard({
  resource,
  unit,
  link,
  onRetry,
}: {
  resource: Resource<Ranked<StudentAttendanceStat>[]>
  unit: AttendanceUnit
  link?: StudentLinkBuilder
  onRetry: () => void
}) {
  return (
    <AnalyticsCard title="นักเรียนที่เข้าเรียนมากที่สุด" icon={ShieldCheck}>
      <SectionBody resource={resource} onRetry={onRetry} skeleton="list">
        {(rows) =>
          rows.length === 0 ? (
            <SectionEmpty
              message="ยังมีข้อมูลการเช็คชื่อไม่พอสำหรับจัดอันดับ"
              hint={`ต้องมีบันทึกอย่างน้อย ${ANALYTICS_RULES.MIN_SESSIONS_FOR_TOP_ATTENDANCE} ${unit} และไม่น้อยกว่า ${ANALYTICS_RULES.MIN_COVERAGE_FOR_TOP_ATTENDANCE * 100}% ของคนที่ถูกเช็คชื่อมากที่สุดในห้อง`}
            />
          ) : (
            <>
              <ol className="space-y-2.5">
                {rows.map(({ rank, item }) => (
                  <li key={item.studentId} className="flex items-center gap-2.5">
                    <RankBadge rank={rank} tone="green" />
                    <Avatar name={item.fullName} />
                    <StudentName stat={item} link={link} />
                    <div className="flex shrink-0 flex-col items-end">
                      <Pill tone="green">มา {formatPercent(item.rate)}</Pill>
                      <span className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {item.present}/{item.total} {unit}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">
                จัดอันดับเฉพาะนักเรียนที่มีบันทึกอย่างน้อย {ANALYTICS_RULES.MIN_SESSIONS_FOR_TOP_ATTENDANCE} {unit} และครอบคลุม ≥{' '}
                {ANALYTICS_RULES.MIN_COVERAGE_FOR_TOP_ATTENDANCE * 100}% ของรอบเช็คชื่อในห้อง · อัตราเท่ากันได้อันดับเดียวกัน
              </p>
            </>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}

export function RiskCard({
  resource,
  unit,
  link,
  onRetry,
}: {
  resource: Resource<RiskEntry[]>
  unit: AttendanceUnit
  link?: StudentLinkBuilder
  onRetry: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const count = resource.status === 'success' ? resource.data.length : 0
  return (
    <AnalyticsCard
      title="นักเรียนที่ควรติดตามการขาดเรียน"
      icon={AlertTriangle}
      action={
        count > ANALYTICS_RULES.TOP_N ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent"
            aria-expanded={expanded}
          >
            {expanded ? 'ย่อรายการ' : `ดูทั้งหมด (${count})`} <ArrowRight className="size-3" />
          </button>
        ) : undefined
      }
    >
      <SectionBody resource={resource} onRetry={onRetry} skeleton="list">
        {(entries) =>
          entries.length === 0 ? (
            <SectionEmpty message="ยังไม่มีนักเรียนที่ถึงเกณฑ์ติดตาม" hint={`เกณฑ์: ขาด ${ANALYTICS_RULES.RISK_MONITOR_ABSENCES} ${unit}ขึ้นไป = เฝ้าระวัง, ${ANALYTICS_RULES.RISK_HIGH_ABSENCES} ${unit}ขึ้นไป = ติดตามด่วน`} />
          ) : (
            <>
              <ol className={cn('space-y-2.5', expanded && 'max-h-80 overflow-y-auto pr-1')}>
                {(expanded ? entries : entries.slice(0, ANALYTICS_RULES.TOP_N)).map((entry, i) => (
                  <li key={entry.stat.studentId} className="flex items-start gap-2.5">
                    <RankBadge rank={i + 1} tone={entry.level === 'high' ? 'red' : 'orange'} />
                    <Avatar name={entry.stat.fullName} />
                    <div className="min-w-0 flex-1">
                      <StudentName stat={entry.stat} link={link} />
                      <p className="text-[11px] leading-snug text-muted-foreground">{entry.reason}</p>
                    </div>
                    <Pill tone={entry.level === 'high' ? 'red' : 'orange'}>{RISK_LEVEL_LABEL[entry.level]}</Pill>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">เป็นตัวชี้วัดเพื่อการติดตามดูแลเท่านั้น ไม่ใช่การวินิจฉัยพฤติกรรม</p>
            </>
          )
        }
      </SectionBody>
    </AnalyticsCard>
  )
}
