import { BookOpen, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { CreateSubjectDialog } from '@/features/subjects-real/create-subject-dialog'
import { EditSubjectDialog } from '@/features/subjects-real/edit-subject-dialog'
import { summarizeSubjectClassrooms } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  archiveSubject,
  countSubjectAttendanceSessions,
  deleteSubjectPermanently,
  getSubjectClassroomsWithCounts,
  getSubjects,
} from '@/services/subject-service'
import type { Subject, SubjectClassroomWithCount } from '@/types/subject'

interface SubjectSummary {
  subject: Subject
  links: SubjectClassroomWithCount[]
}

/**
 * List page's "..." menu is the only entry point to EditSubjectDialog for
 * an already-created subject — that dialog already supports checking/
 * unchecking linked classrooms and already persists through the real
 * subject-service (updateSubject/linkClassroomToSubject/
 * unlinkClassroomFromSubject), see edit-subject-dialog.tsx. This page
 * only had to wire a visible way to open it; nothing about the dialog
 * itself changed here.
 */
export function SubjectsPageReal() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [summaries, setSummaries] = useState<SubjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
  const [archivingSubject, setArchivingSubject] = useState<Subject | null>(null)
  const [deletingSubject, setDeletingSubject] = useState<{ subject: Subject; attendanceSessionCount: number } | null>(null)
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getSubjects()
      .then(async (subjects) => {
        const rows = await Promise.all(
          subjects.map(async (subject) => ({
            subject,
            links: await getSubjectClassroomsWithCounts(subject.id),
          })),
        )
        setSummaries(rows)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleArchive() {
    if (!archivingSubject) return
    try {
      await archiveSubject(archivingSubject.id)
      toast(`เก็บถาวรรายวิชา "${archivingSubject.name}" แล้ว`)
      setArchivingSubject(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเก็บถาวรรายวิชาได้'))
    }
  }

  /**
   * Opens the permanent-delete confirmation. Same shape as the assignment
   * tab's handleDeleteMenuClick: this is NOT the delete itself and NOT an
   * authorization check (the database enforces ownership inside
   * deleteSubjectPermanently's RPC) — it only counts this subject's
   * เช็คชื่อ sessions so the dialog can say, in concrete terms, that
   * attendance history will be permanently deleted too when there is any.
   */
  async function handleDeleteMenuClick(subject: Subject) {
    setCheckingDeleteId(subject.id)
    try {
      const attendanceSessionCount = await countSubjectAttendanceSessions(subject.id)
      setDeletingSubject({ subject, attendanceSessionCount })
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถตรวจสอบข้อมูลรายวิชาได้'))
    } finally {
      setCheckingDeleteId(null)
    }
  }

  async function handleDeletePermanently() {
    if (!deletingSubject) return
    const { subject } = deletingSubject
    try {
      await deleteSubjectPermanently(subject.id)
      toast(`ลบรายวิชา "${subject.name}" แล้ว`)
      setDeletingSubject(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบรายวิชานี้ได้'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายวิชา</h1>
          <p className="mt-1 text-sm text-muted-foreground">{loading ? 'กำลังโหลด...' : `${summaries.length} รายวิชา`}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          สร้างรายวิชา
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && summaries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีรายวิชา</p>
            <Button onClick={() => setCreateOpen(true)}>สร้างรายวิชา</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {summaries.map(({ subject, links }) => {
            const summary = summarizeSubjectClassrooms(links)
            const classroomNames = links
              .map((link) => link.classroomName)
              .filter(Boolean)
              .join(' · ')

            return (
              <Card
                key={subject.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/teacher/subjects/${subject.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{subject.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      {subject.subjectCode && <Badge variant="outline">{subject.subjectCode}</Badge>}
                      <RowActionsMenu
                        actions={[
                          {
                            key: 'open',
                            label: 'เปิดรายวิชา',
                            onSelect: () => navigate(`/teacher/subjects/${subject.id}`),
                          },
                          {
                            key: 'edit',
                            label: 'แก้ไขรายวิชา',
                            onSelect: () => setEditingSubject(subject),
                          },
                          {
                            key: 'archive',
                            label: 'เก็บถาวร',
                            onSelect: () => setArchivingSubject(subject),
                          },
                          {
                            key: 'delete',
                            label: 'ลบรายวิชา',
                            destructive: true,
                            separatorBefore: true,
                            disabled: checkingDeleteId === subject.id,
                            onSelect: () => handleDeleteMenuClick(subject),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    {summary.totalClassrooms} ห้องเรียน · {summary.totalStudents} คน
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Users className="size-3.5 shrink-0" />
                    <span>{classroomNames || '-'}</span>
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CreateSubjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refresh()} />

      {editingSubject && (
        <EditSubjectDialog
          open={Boolean(editingSubject)}
          onOpenChange={(open) => !open && setEditingSubject(null)}
          subject={editingSubject}
          onSaved={() => {
            setEditingSubject(null)
            refresh()
          }}
        />
      )}

      {archivingSubject && (
        <ConfirmDialog
          open={Boolean(archivingSubject)}
          onOpenChange={(open) => !open && setArchivingSubject(null)}
          title="เก็บถาวรรายวิชา"
          description={`เก็บถาวร "${archivingSubject.name}"?\nรายวิชาจะยังคงอยู่ในระบบ แต่จะถูกเก็บถาวร`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchive}
        />
      )}

      {deletingSubject && (
        <ConfirmDialog
          open={Boolean(deletingSubject)}
          onOpenChange={(open) => !open && setDeletingSubject(null)}
          title="ลบรายวิชาและข้อมูลทั้งหมด?"
          description={
            deletingSubject.attendanceSessionCount > 0
              ? `รายวิชานี้มีข้อมูลการเช็คชื่อ (การเข้าเรียน) ที่บันทึกไว้ ${deletingSubject.attendanceSessionCount} ครั้ง\nการลบรายวิชาจะลบบทเรียน งาน คะแนน การส่งงาน ประวัติการเช็คชื่อของรายวิชานี้ และข้อมูลที่เกี่ยวข้องออกจากระบบอย่างถาวร และไม่สามารถกู้คืนได้\nข้อมูลนักเรียน ห้องเรียน และการเช็คชื่อของรายวิชาอื่นจะไม่ถูกลบ`
              : 'การลบรายวิชาจะลบบทเรียน งาน คะแนน การส่งงาน ประวัติการเช็คชื่อของรายวิชานี้ และข้อมูลที่เกี่ยวข้องออกจากระบบอย่างถาวร และไม่สามารถกู้คืนได้'
          }
          confirmLabel="ลบรายวิชาและข้อมูลทั้งหมด"
          destructive
          onConfirm={handleDeletePermanently}
        />
      )}
    </div>
  )
}
