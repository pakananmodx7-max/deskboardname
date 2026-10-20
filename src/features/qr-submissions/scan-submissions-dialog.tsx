import { AlertTriangle, Bluetooth, Camera, CheckCircle2, Loader2, RefreshCw, ScanQrCode, Search, Settings2, Volume2, VolumeX, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { StudentAvatar } from '@/components/layout/student-avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/select'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getAssignments, getSubmissions } from '@/services/assignment-service'
import {
  correctSubmissionStatus,
  QrFeatureUnavailableError,
  QrRequestError,
  recordSubmissionManual,
  recordSubmissionScan,
  updateSubmissionSettings,
} from '@/services/qr-submission-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { ClassroomStudent } from '@/types/student'
import type { Subject } from '@/types/subject'

import { CameraScanner } from './camera-scanner'
import { HidScannerInput } from './hid-scanner-input'
import { parseQrPayload } from './qr-payload'
import { playScanFeedback, readSoundEnabled, writeSoundEnabled } from './scan-feedback'
import {
  applyScanResult,
  cameraStillInView,
  countSubmissions,
  describeSubmissionWindow,
  feedbackFor,
  formatThaiTime,
  isRepeatScan,
  matchesStudentQuery,
  scoreDisplay,
  submissionStatusDisplay,
  type RecentScan,
  type ScanFeedback,
  type ScannedStudent,
  type StatusTone,
} from './scan-model'
import { CorrectionDialog, SubmissionSettingsDialog } from './submission-dialogs'

type ScanMode = 'camera' | 'hid'
type RosterFilter = 'all' | 'pending' | 'done'

interface ScanJob {
  kind: 'qr' | 'manual'
  /** Scanned text (qr) or student id (manual). */
  value: string
  key: string
  /** Captured when scanned — a job only ever writes to this assignment. */
  assignmentId: string
}

interface LatestResult {
  feedback: ScanFeedback
  student: ScannedStudent | null
  status: SubmissionStatus | null
  submittedAt: string | null
  assignmentId: string
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/25 text-foreground',
  muted: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/12 text-destructive',
  neutral: 'bg-secondary text-secondary-foreground',
}

function defaultMode(): ScanMode {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'camera' : 'hid'
  } catch {
    return 'hid'
  }
}

function semesterLabel(subject: Subject): string | null {
  if (subject.semester && subject.academicYear) return `ภาคเรียนที่ ${subject.semester}/${subject.academicYear}`
  if (subject.academicYear) return `ปีการศึกษา ${subject.academicYear}`
  return null
}

/**
 * สแกน QR ตรวจงาน — record submissions for ONE selected assignment by
 * scanning students' permanent QR codes (phone camera or a Bluetooth/USB
 * HID scanner), with a live roster. Every write goes through the
 * server-side RPCs (migration 0030); a result is shown only after the
 * server confirmed it, and scores are never touched.
 */
export function ScanSubmissionsDialog({
  subject,
  classroomId,
  classroomName,
  initialAssignmentId,
  onClose,
}: {
  subject: Subject
  classroomId: string
  classroomName: string
  initialAssignmentId: string | null
  /** `changed` = at least one submission was recorded or corrected. */
  onClose: (changed: boolean) => void
}) {
  const [base, setBase] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; assignments: Assignment[]; students: ClassroomStudent[] }>({ status: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(initialAssignmentId)
  const [subs, setSubs] = useState<{ assignmentId: string; data: Record<string, AssignmentSubmission> } | { assignmentId: string; error: string } | null>(null)
  const [mode, setMode] = useState<ScanMode>(defaultMode)
  const [processing, setProcessing] = useState(false)
  const [latest, setLatest] = useState<LatestResult | null>(null)
  const [history, setHistory] = useState<LatestResult[]>([])
  const [blocked, setBlocked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [sound, setSound] = useState(readSoundEnabled)
  const [correcting, setCorrecting] = useState<ClassroomStudent | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const queue = useRef<ScanJob[]>([])
  const busy = useRef(false)
  const recent = useRef<RecentScan | null>(null)
  const cameraSeen = useRef<RecentScan | null>(null)
  const changed = useRef(false)
  const soundRef = useRef(sound)
  const selectedRef = useRef(selectedId)
  const assignmentsRef = useRef<Assignment[]>([])

  // Base data: assignments + classroom roster.
  useEffect(() => {
    let active = true
    Promise.all([getAssignments(subject.id, classroomId), getStudentsByClassroom(classroomId)])
      .then(([assignments, students]) => {
        if (!active) return
        setBase({ status: 'ready', assignments, students })
      })
      .catch((err: unknown) => active && setBase({ status: 'error', message: toFriendlyErrorMessage(err, 'โหลดข้อมูลไม่สำเร็จ') }))
    return () => {
      active = false
    }
  }, [subject.id, classroomId])

  const openAssignments = useMemo(() => (base.status === 'ready' ? base.assignments.filter((a) => !a.isArchived) : []), [base])
  const effectiveId = selectedId && openAssignments.some((a) => a.id === selectedId) ? selectedId : (openAssignments[0]?.id ?? null)
  const assignment = openAssignments.find((a) => a.id === effectiveId) ?? null

  useEffect(() => {
    soundRef.current = sound
    selectedRef.current = effectiveId
    assignmentsRef.current = openAssignments
  }, [sound, effectiveId, openAssignments])

  // Submissions of the selected assignment (re-fetched on switch / refresh).
  useEffect(() => {
    if (!effectiveId) return
    let active = true
    getSubmissions(effectiveId)
      .then((data) => active && setSubs({ assignmentId: effectiveId, data }))
      .catch((err: unknown) => active && setSubs({ assignmentId: effectiveId, error: toFriendlyErrorMessage(err, 'โหลดสถานะการส่งงานไม่สำเร็จ') }))
    return () => {
      active = false
    }
  }, [effectiveId, reloadKey])

  const currentSubs = subs && subs.assignmentId === effectiveId && 'data' in subs ? subs.data : null
  const subsError = subs && subs.assignmentId === effectiveId && 'error' in subs ? subs.error : null

  const students = useMemo(
    () => (base.status === 'ready' ? [...base.students].sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)) : []),
    [base],
  )
  const counts = assignment && currentSubs ? countSubmissions(students.map((s) => s.id), currentSubs, assignment) : null

  const processJob = useCallback(async (job: ScanJob) => {
    const target = assignmentsRef.current.find((a) => a.id === job.assignmentId)
    if (!target) return
    try {
      const result = job.kind === 'qr' ? await recordSubmissionScan(job.assignmentId, job.value) : await recordSubmissionManual(job.assignmentId, job.value)
      if (!result) {
        const feedback: ScanFeedback = { kind: 'error', title: 'QR ไม่ถูกต้อง', detail: 'ไม่ใช่ QR ประจำตัวนักเรียนของ KrunameClass' }
        setLatest({ feedback, student: null, status: null, submittedAt: null, assignmentId: job.assignmentId })
        playScanFeedback('error', soundRef.current)
        return
      }
      const feedback = feedbackFor(result, target)
      if (result.outcome === 'recorded') changed.current = true
      // Only the assignment the scan was made for, and only once confirmed.
      if (selectedRef.current === job.assignmentId) {
        setSubs((prev) => (prev && prev.assignmentId === job.assignmentId && 'data' in prev ? { assignmentId: job.assignmentId, data: applyScanResult(prev.data, result) } : prev))
      }
      const entry: LatestResult = { feedback, student: result.student, status: result.submission?.status ?? null, submittedAt: result.submission?.submittedAt ?? null, assignmentId: job.assignmentId }
      setLatest(entry)
      setHistory((prev) => [entry, ...prev].slice(0, 8))
      playScanFeedback(feedback.kind, soundRef.current)
    } catch (err) {
      if (err instanceof QrFeatureUnavailableError || (err instanceof QrRequestError && err.kind === 'session')) {
        setBlocked(err.message)
        queue.current = []
      }
      const feedback: ScanFeedback = { kind: 'error', title: 'บันทึกไม่สำเร็จ — ยังไม่ได้บันทึก', detail: err instanceof Error ? err.message : 'กรุณาลองใหม่' }
      setLatest({ feedback, student: null, status: null, submittedAt: null, assignmentId: job.assignmentId })
      playScanFeedback('error', soundRef.current)
      // Let the same QR be retried right away after a failure.
      recent.current = null
    }
  }, [])

  const pump = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setProcessing(true)
    try {
      while (queue.current.length > 0) {
        const job = queue.current.shift()!
        await processJob(job)
      }
    } finally {
      busy.current = false
      setProcessing(false)
    }
  }, [processJob])

  const enqueue = useCallback(
    (job: Omit<ScanJob, 'assignmentId' | 'key'> & { key: string }) => {
      const assignmentId = selectedRef.current
      if (!assignmentId || blocked) return
      const key = `${assignmentId}:${job.key}`
      const now = Date.now()
      if (isRepeatScan(recent.current, key, now) || queue.current.some((q) => q.key === key)) return
      recent.current = { key, at: now }
      queue.current.push({ ...job, key, assignmentId })
      void pump()
    },
    [blocked, pump],
  )

  const handleScanText = useCallback(
    (text: string) => {
      const token = parseQrPayload(text)
      if (!token) {
        const key = `invalid:${text}`
        const now = Date.now()
        if (isRepeatScan(recent.current, key, now)) return
        recent.current = { key, at: now }
        const feedback: ScanFeedback = { kind: 'error', title: 'QR ไม่ถูกต้อง', detail: 'ไม่ใช่ QR ประจำตัวนักเรียนของ KrunameClass' }
        setLatest({ feedback, student: null, status: null, submittedAt: null, assignmentId: selectedRef.current ?? '' })
        playScanFeedback('error', soundRef.current)
        return
      }
      enqueue({ kind: 'qr', value: text, key: token })
    },
    [enqueue],
  )

  // The camera reports a code on every frame it is visible: count it once
  // per appearance (the server would only answer "duplicate" anyway).
  const handleCameraText = useCallback(
    (text: string) => {
      const { stillInView, next } = cameraStillInView(cameraSeen.current, `${selectedRef.current}:${text}`, Date.now())
      cameraSeen.current = next
      if (!stillInView) handleScanText(text)
    },
    [handleScanText],
  )

  const visibleStudents = students.filter((s) => {
    if (!matchesStudentQuery(s, query)) return false
    if (filter === 'all') return true
    const status = currentSubs?.[s.id]?.status ?? 'not_submitted'
    const done = status === 'submitted' || status === 'late' || status === 'excused'
    return filter === 'done' ? done : !done
  })

  const latestTone = latest?.feedback.kind
  const scanningActive = !blocked && assignment !== null && correcting === null && !settingsOpen

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(changed.current)}>
      <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:left-1/2 sm:top-1/2 sm:h-[92vh] sm:max-h-[92vh] sm:max-w-6xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        {/* Header: context + assignment selection */}
        <div className="border-b border-border px-4 pb-3 pt-4 sm:px-6">
          <div className="flex items-start gap-3 pr-8">
            <span className="kc-tone-blue kc-tone-chip flex size-10 shrink-0 items-center justify-center rounded-xl">
              <ScanQrCode className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold">สแกน QR ตรวจงาน</DialogTitle>
              <DialogDescription className="mt-1 truncate">
                {[semesterLabel(subject), classroomName, subject.name].filter(Boolean).join(' · ')}
              </DialogDescription>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <label htmlFor="scan-assignment" className="shrink-0 text-sm font-medium">
              งานที่ตรวจ
            </label>
            <NativeSelect
              id="scan-assignment"
              value={effectiveId ?? ''}
              onChange={(e) => {
                setSelectedId(e.target.value || null)
                setFilter('all')
              }}
              disabled={openAssignments.length === 0}
              className="h-10 w-full min-w-0 rounded-full px-4 text-sm font-semibold sm:w-72"
            >
              {openAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </NativeSelect>
            </div>
            {assignment && (
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-4" />
                ตั้งค่าการรับงาน
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto rounded-full"
              aria-pressed={sound}
              onClick={() => {
                const next = !sound
                setSound(next)
                writeSoundEnabled(next)
              }}
            >
              {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              {sound ? 'เสียงเปิด' : 'เสียงปิด'}
            </Button>
          </div>
          {assignment && (
            <p className={cn('mt-2 text-xs', assignment.acceptingSubmissions ? 'text-muted-foreground' : 'font-medium text-destructive')}>{describeSubmissionWindow(assignment)}</p>
          )}
        </div>

        {base.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center" role="status">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="sr-only">กำลังโหลด</span>
          </div>
        ) : base.status === 'error' ? (
          <p role="alert" className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {base.message}
          </p>
        ) : openAssignments.length === 0 ? (
          <p className="m-6 rounded-xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">ยังไม่มีงานในห้องเรียนนี้ — สร้างงานก่อน แล้วจึงสแกน QR ตรวจงาน</p>
        ) : (
          <div className="grid flex-1 gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden">
            {/* Scanner column */}
            <section aria-label="สแกน" className="space-y-4 lg:overflow-y-auto lg:pr-1">
              {blocked && (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {blocked}
                </p>
              )}
              <div role="tablist" aria-label="วิธีสแกน" className="grid grid-cols-2 gap-1 rounded-full border border-border bg-muted/40 p-1">
                {(
                  [
                    { key: 'camera', label: 'กล้องโทรศัพท์', extra: '', icon: Camera },
                    { key: 'hid', label: 'เครื่องสแกน', extra: ' Bluetooth/USB', icon: Bluetooth },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={mode === m.key}
                    onClick={() => setMode(m.key)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-sm',
                      mode === m.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <m.icon className="size-4 shrink-0" />
                    <span className="truncate">
                      {m.label}
                      {m.extra && <span className="hidden sm:inline">{m.extra}</span>}
                    </span>
                  </button>
                ))}
              </div>

              {mode === 'camera' ? (
                <CameraScanner paused={processing || !scanningActive} onDetected={handleCameraText} />
              ) : (
                <HidScannerInput active={scanningActive} onScan={handleScanText} />
              )}

              {/* Latest result — only after the server answered */}
              <div aria-live="assertive" aria-atomic="true">
                {processing && (
                  <p className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" />
                    กำลังบันทึก... ยังไม่ยืนยันจนกว่าเซิร์ฟเวอร์ตอบกลับ
                  </p>
                )}
                {!processing && latest && (
                  <div
                    data-testid="scan-latest"
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border p-4',
                      latestTone === 'success' && 'border-success/40 bg-success/10',
                      latestTone === 'warning' && 'border-warning/60 bg-warning/15',
                      latestTone === 'error' && 'border-destructive/40 bg-destructive/8',
                    )}
                  >
                    {latest.student ? (
                      <StudentAvatar avatarPath={latest.student.avatarPath} firstName={latest.student.firstName} className="size-12 shrink-0 text-sm" />
                    ) : latestTone === 'error' ? (
                      <XCircle className="size-10 shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="size-10 shrink-0 text-success" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-bold text-foreground">
                        {latestTone === 'success' && <CheckCircle2 className="size-4 shrink-0 text-success" />}
                        {latestTone === 'warning' && <AlertTriangle className="size-4 shrink-0 text-foreground" />}
                        <span className="truncate">{latest.feedback.title}</span>
                      </p>
                      {latest.student && (
                        <p className="text-sm text-muted-foreground">
                          เลขที่ {latest.student.number ?? '-'}
                          {latest.student.studentCode ? ` · รหัส ${latest.student.studentCode}` : ''}
                        </p>
                      )}
                      <p className="text-sm text-foreground">{latest.feedback.detail}</p>
                    </div>
                  </div>
                )}
                {!processing && !latest && (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">ผลการสแกนล่าสุดจะแสดงที่นี่</p>
                )}
              </div>

              {history.length > 1 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">สแกนก่อนหน้า</p>
                  <ul className="space-y-1">
                    {history.slice(1).map((h, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={cn('size-2 shrink-0 rounded-full', h.feedback.kind === 'success' ? 'bg-success' : h.feedback.kind === 'warning' ? 'bg-warning' : 'bg-destructive')} />
                        <span className="truncate">{h.feedback.title}</span>
                        {h.submittedAt && <span className="ml-auto shrink-0 tabular-nums">{formatThaiTime(h.submittedAt)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Roster column */}
            <section aria-label="รายชื่อนักเรียน" className="flex min-h-0 flex-col rounded-2xl border border-border bg-card lg:overflow-hidden">
              <div className="space-y-3 border-b border-border p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="scan-counts">
                  {counts ? (
                    <>
                      <span className="rounded-full bg-success/15 px-2.5 py-1 font-semibold text-success">
                        ส่งแล้ว {counts.submitted}/{counts.total - counts.excused}
                      </span>
                      {counts.late > 0 && <span className="rounded-full bg-warning/25 px-2.5 py-1 font-semibold text-foreground">ส่งช้า {counts.late}</span>}
                      <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">ยังไม่ส่ง {counts.notSubmitted}</span>
                      {counts.missing > 0 && <span className="rounded-full bg-destructive/12 px-2.5 py-1 font-semibold text-destructive">ขาดส่ง {counts.missing}</span>}
                      {counts.excused > 0 && <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">ยกเว้น {counts.excused}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">กำลังโหลดสถานะ...</span>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 rounded-full px-2" onClick={() => setReloadKey((k) => k + 1)} aria-label="โหลดสถานะล่าสุด (รวมการสแกนจากเครื่องอื่น)">
                    <RefreshCw className="size-3.5" />
                    รีเฟรช
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="ค้นหาชื่อหรือเลขที่"
                      aria-label="ค้นหานักเรียน"
                      className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                  </div>
                  <div className="flex gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                    {(
                      [
                        { key: 'all', label: 'ทั้งหมด' },
                        { key: 'pending', label: 'ยังไม่ส่ง' },
                        { key: 'done', label: 'ส่งแล้ว' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={filter === f.key}
                        onClick={() => setFilter(f.key)}
                        className={cn('rounded-full px-2.5 py-1 text-xs font-medium', filter === f.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {subsError ? (
                <p role="alert" className="m-4 text-sm text-destructive">
                  {subsError}
                </p>
              ) : (
                <ul className="divide-y divide-border lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-label="สถานะการส่งงานรายคน">
                  {visibleStudents.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">ไม่พบนักเรียน</li>}
                  {visibleStudents.map((student) => {
                    const submission = currentSubs?.[student.id]
                    const status = assignment ? submissionStatusDisplay(submission, assignment) : null
                    const done = submission && (submission.status === 'submitted' || submission.status === 'late' || submission.status === 'excused')
                    return (
                      <li key={student.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{student.number ?? '-'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {student.firstName} {student.lastName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {currentSubs ? `${scoreDisplay(submission, assignment?.maxScore ?? 0)}${submission?.submittedAt ? ` · ${formatThaiTime(submission.submittedAt)}` : ''}` : '...'}
                          </p>
                        </div>
                        {status && currentSubs && <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE_CLASS[status.tone])}>{status.label}</span>}
                        {currentSubs && !done && !blocked && (
                          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 rounded-full px-2.5" onClick={() => enqueue({ kind: 'manual', value: student.id, key: `manual:${student.id}` })}>
                            บันทึกว่าส่ง
                          </Button>
                        )}
                        {currentSubs && !blocked && (
                          <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 rounded-full px-2.5 text-muted-foreground" onClick={() => setCorrecting(student)}>
                            แก้ไข
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        )}

        <CorrectionDialog
          target={
            correcting && assignment
              ? { studentName: `${correcting.firstName} ${correcting.lastName}`, assignmentTitle: assignment.title, currentStatus: currentSubs?.[correcting.id]?.status ?? 'not_submitted' }
              : null
          }
          onSubmit={async (status, reason) => {
            if (!correcting || !assignment) return
            const result = await correctSubmissionStatus(assignment.id, correcting.id, status, reason)
            changed.current = true
            const studentId = correcting.id
            setSubs((prev) =>
              prev && prev.assignmentId === assignment.id && 'data' in prev
                ? {
                    assignmentId: assignment.id,
                    data: {
                      ...prev.data,
                      [studentId]: { ...(prev.data[studentId] ?? { studentId, score: null, note: null }), status: result.status, submittedAt: result.submittedAt },
                    },
                  }
                : prev,
            )
          }}
          onClose={() => setCorrecting(null)}
        />
        <SubmissionSettingsDialog
          assignment={settingsOpen ? assignment : null}
          onSubmit={async (input) => {
            if (!assignment) return
            await updateSubmissionSettings(assignment.id, input)
            setBase((prev) =>
              prev.status === 'ready' ? { ...prev, assignments: prev.assignments.map((a) => (a.id === assignment.id ? { ...a, ...input } : a)) } : prev,
            )
          }}
          onClose={() => setSettingsOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
