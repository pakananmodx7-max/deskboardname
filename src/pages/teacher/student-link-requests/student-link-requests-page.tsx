import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  approveLinkRequest,
  bulkApproveLinkRequests,
  getLinkRequestsForTeacher,
  rejectLinkRequest,
} from '@/services/student-link-service'
import type { StudentLinkRequestForReview } from '@/types/student-link-request'

/**
 * Real, Supabase-backed review queue for student account-link requests.
 * RLS (student_account_link_requests_select_own_or_teacher, 0008)
 * already scopes what getLinkRequestsForTeacher returns to students
 * currently in one of THIS teacher's own classrooms — there is no
 * client-side filtering by classroom here because none is needed, the
 * database never returns another teacher's requests in the first place.
 * Every approve/reject goes through the approve_student_link_request/
 * reject_student_link_request RPCs (SECURITY DEFINER, re-verify
 * ownership themselves) — this page never writes to
 * student_account_link_requests or students directly.
 */
export function StudentLinkRequestsPage() {
  const { toast } = useToast()

  const [requests, setRequests] = useState<StudentLinkRequestForReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkApproving, setBulkApproving] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const [rejectTarget, setRejectTarget] = useState<StudentLinkRequestForReview | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getLinkRequestsForTeacher('pending')
      .then((rows) => {
        setRequests(rows)
        setSelectedIds((prev) => prev.filter((id) => rows.some((r) => r.id === id)))
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const allSelected = requests.length > 0 && selectedIds.length === requests.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : requests.map((r) => r.id))
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleApprove(request: StudentLinkRequestForReview) {
    setApprovingId(request.id)
    try {
      await approveLinkRequest(request.id)
      toast(`อนุมัติคำขอของ ${request.studentFirstName} ${request.studentLastName} แล้ว`)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถอนุมัติคำขอได้'))
    } finally {
      setApprovingId(null)
    }
  }

  async function handleBulkApprove() {
    if (selectedIds.length === 0) return
    setBulkApproving(true)
    try {
      const result = await bulkApproveLinkRequests(selectedIds)
      if (result.succeeded.length > 0) {
        toast(`อนุมัติสำเร็จ ${result.succeeded.length} รายการ`)
      }
      if (result.failed.length > 0) {
        toast(`ไม่สามารถอนุมัติได้ ${result.failed.length} รายการ — อาจถูกดำเนินการไปแล้วหรือมีการเปลี่ยนแปลง`)
      }
      setSelectedIds([])
      refresh()
    } finally {
      setBulkApproving(false)
    }
  }

  async function handleRejectSubmit(event: FormEvent) {
    event.preventDefault()
    if (!rejectTarget) return
    setRejecting(true)
    try {
      await rejectLinkRequest(rejectTarget.id, rejectNote.trim() || undefined)
      toast(`ปฏิเสธคำขอของ ${rejectTarget.studentFirstName} ${rejectTarget.studentLastName} แล้ว`)
      setRejectTarget(null)
      setRejectNote('')
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถปฏิเสธคำขอได้'))
    } finally {
      setRejecting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">คำขอเชื่อมบัญชีนักเรียน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          คำขอเชื่อมบัญชีจากนักเรียนในห้องเรียนของคุณ — อนุมัติเพื่อเชื่อมบัญชีถาวร หรือปฏิเสธหากข้อมูลไม่ถูกต้อง
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && requests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4 rounded border-input" />
            เลือกทั้งหมด
          </label>
          <span className="text-xs text-muted-foreground">{selectedIds.length > 0 && `เลือก ${selectedIds.length} รายการ`}</span>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={selectedIds.length === 0 || bulkApproving}
            onClick={handleBulkApprove}
          >
            {bulkApproving ? 'กำลังอนุมัติ...' : `อนุมัติที่เลือก (${selectedIds.length})`}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">ไม่มีคำขอเชื่อมบัญชีที่รอดำเนินการ</p>
            <p className="text-sm text-muted-foreground">คำขอใหม่จากนักเรียนในห้องเรียนของคุณจะปรากฏที่นี่</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {requests.map((request) => (
            <Card key={request.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(request.id)}
                      onChange={() => toggleSelect(request.id)}
                      className="mt-0.5 size-4 rounded border-input"
                    />
                    <div>
                      <p className="text-sm font-semibold">
                        {request.studentFirstName} {request.studentLastName}
                      </p>
                      {request.studentCode && <p className="text-xs text-muted-foreground">รหัสนักเรียน: {request.studentCode}</p>}
                    </div>
                  </label>
                  <Badge variant="outline">รอดำเนินการ</Badge>
                </div>

                <div className="rounded-md border border-border bg-accent/30 p-2 text-xs text-muted-foreground">
                  <p>ผู้ขอ: {request.requesterDisplayName ?? 'ไม่ระบุชื่อ'}</p>
                  {request.requesterEmail && <p>อีเมล: {request.requesterEmail}</p>}
                  <p>ส่งคำขอเมื่อ: {new Date(request.createdAt).toLocaleString('th-TH')}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    disabled={approvingId === request.id}
                    onClick={() => handleApprove(request)}
                  >
                    {approvingId === request.id ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setRejectTarget(request)
                      setRejectNote('')
                    }}
                  >
                    ปฏิเสธ
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ปฏิเสธคำขอเชื่อมบัญชี</DialogTitle>
            <DialogDescription>
              {rejectTarget && `ปฏิเสธคำขอของ ${rejectTarget.studentFirstName} ${rejectTarget.studentLastName}`}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRejectSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="reject-note">เหตุผล (ไม่บังคับ)</Label>
              <Input
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="เช่น รหัสนักเรียนไม่ตรงกับข้อมูล"
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={rejecting}>
                {rejecting ? 'กำลังปฏิเสธ...' : 'ปฏิเสธคำขอ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
