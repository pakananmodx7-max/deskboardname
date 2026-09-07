import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeTotal } from '@/demo/grades'
import type { DemoStudent } from '@/demo/types'
import { AddEditStudentDialog } from '@/features/demo-students/add-edit-student-dialog'
import { ImportSampleDialog } from '@/features/demo-students/import-sample-dialog'
import { StudentDetailDrawer } from '@/features/demo-students/student-detail-drawer'
import { cn } from '@/lib/utils'

type SortKey = 'number' | 'studentCode' | 'name' | 'missing' | 'average'
type SortDirection = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'

const statusLabel: Record<DemoStudent['status'], string> = {
  active: 'กำลังศึกษา',
  inactive: 'พ้นสภาพ',
}

const statusVariant: Record<DemoStudent['status'], 'success' | 'secondary'> = {
  active: 'success',
  inactive: 'secondary',
}

function sortValue(
  student: DemoStudent,
  key: SortKey,
  grades: ReturnType<typeof useDemoClassroom>['grades'],
  missingByStudent: Record<string, number>,
): number | string {
  switch (key) {
    case 'number':
      return student.number
    case 'studentCode':
      return student.studentCode
    case 'name':
      return `${student.firstName} ${student.lastName}`
    case 'missing':
      return missingByStudent[student.id] ?? 0
    case 'average':
      return grades[student.id] ? computeTotal(grades[student.id]) : 0
  }
}

interface SortHeaderProps {
  label: string
  sortKeyName: SortKey
  activeSortKey: SortKey
  sortDirection: SortDirection
  onToggle: (key: SortKey) => void
}

function SortHeader({ label, sortKeyName, activeSortKey, sortDirection, onToggle }: SortHeaderProps) {
  const isActive = activeSortKey === sortKeyName
  const Icon = isActive ? (sortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKeyName)}
      className={cn(
        'flex items-center gap-1 text-xs font-medium hover:text-foreground',
        isActive ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <Icon className="size-3" />
    </button>
  )
}

export function StudentsPageDemo() {
  const { students, grades, missingByStudent } = useDemoClassroom()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('number')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<DemoStudent | null>(null)
  const [viewingStudent, setViewingStudent] = useState<DemoStudent | null>(null)

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = students.filter((student) => {
      if (statusFilter !== 'all' && student.status !== statusFilter) return false
      if (!query) return true
      const fullName = `${student.firstName} ${student.lastName}`.toLowerCase()
      return fullName.includes(query) || student.studentCode.toLowerCase().includes(query)
    })

    const sorted = [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey, grades, missingByStudent)
      const vb = sortValue(b, sortKey, grades, missingByStudent)
      const compared = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'th')
      return sortDirection === 'asc' ? compared : -compared
    })

    return sorted
  }, [students, search, statusFilter, sortKey, sortDirection, grades, missingByStudent])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายชื่อนักเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">{students.length} คน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import Students
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            เพิ่มนักเรียน
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาด้วยชื่อหรือรหัสนักเรียน"
            className="pl-9"
          />
        </div>
        <NativeSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="w-auto"
          aria-label="กรองตามสถานะ"
        >
          <option value="all">ทุกสถานะ</option>
          <option value="active">กำลังศึกษา</option>
          <option value="inactive">พ้นสภาพ</option>
        </NativeSelect>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredStudents.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">ไม่พบนักเรียนที่ตรงกับเงื่อนไข</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3">
                      <SortHeader label="เลขที่" sortKeyName="number" activeSortKey={sortKey} sortDirection={sortDirection} onToggle={toggleSort} />
                    </th>
                    <th className="px-5 py-3">
                      <SortHeader label="รหัสนักเรียน" sortKeyName="studentCode" activeSortKey={sortKey} sortDirection={sortDirection} onToggle={toggleSort} />
                    </th>
                    <th className="px-5 py-3">
                      <SortHeader label="ชื่อ-นามสกุล" sortKeyName="name" activeSortKey={sortKey} sortDirection={sortDirection} onToggle={toggleSort} />
                    </th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground">ชื่อเล่น</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground">ห้อง</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground">สถานะ</th>
                    <th className="px-5 py-3">
                      <SortHeader label="งานค้าง" sortKeyName="missing" activeSortKey={sortKey} sortDirection={sortDirection} onToggle={toggleSort} />
                    </th>
                    <th className="px-5 py-3">
                      <SortHeader label="คะแนนเฉลี่ย" sortKeyName="average" activeSortKey={sortKey} sortDirection={sortDirection} onToggle={toggleSort} />
                    </th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student) => {
                    const missing = missingByStudent[student.id] ?? 0
                    const total = grades[student.id] ? computeTotal(grades[student.id]) : 0
                    return (
                      <tr
                        key={student.id}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/50"
                        onClick={() => setViewingStudent(student)}
                      >
                        <td className="px-5 py-3 text-muted-foreground">{student.number}</td>
                        <td className="px-5 py-3">{student.studentCode}</td>
                        <td className="px-5 py-3 font-medium">
                          {student.firstName} {student.lastName}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{student.nickname}</td>
                        <td className="px-5 py-3 text-muted-foreground">{student.classroom}</td>
                        <td className="px-5 py-3">
                          <Badge variant={statusVariant[student.status]}>{statusLabel[student.status]}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          {missing > 0 ? (
                            <Badge variant="warning">{missing} งาน</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-medium">{total}/100</td>
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingStudent(student)}
                          >
                            แก้ไข
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddEditStudentDialog open={addOpen} onOpenChange={setAddOpen} />
      <AddEditStudentDialog
        open={Boolean(editingStudent)}
        onOpenChange={(open) => !open && setEditingStudent(null)}
        student={editingStudent}
      />
      <ImportSampleDialog open={importOpen} onOpenChange={setImportOpen} />
      <StudentDetailDrawer student={viewingStudent} onOpenChange={(open) => !open && setViewingStudent(null)} />
    </div>
  )
}
