import { BarChart3, ClipboardX, Download, FileText, UserSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/select'
import { ATTENDANCE_STATUS_LABEL, ATTENDANCE_STATUS_ORDER } from '@/demo/attendance'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeTotal } from '@/demo/grades'

type ReportType = 'attendance' | 'grades' | 'missing' | 'individual'

const REPORT_TYPES: { type: ReportType; title: string; description: string; icon: typeof FileText }[] = [
  { type: 'attendance', title: 'Attendance Report', description: 'สรุปการเข้าเรียนของห้อง', icon: FileText },
  { type: 'grades', title: 'Grade Summary', description: 'สรุปคะแนนและสถิติของห้อง', icon: BarChart3 },
  { type: 'missing', title: 'Missing Assignment Report', description: 'รายชื่อนักเรียนที่มีงานค้าง', icon: ClipboardX },
  { type: 'individual', title: 'Individual Student Report', description: 'รายงานรายบุคคล', icon: UserSearch },
]

export function ReportsPage() {
  const { students, attendanceSummary, gradeStats, grades, missingByStudent } = useDemoClassroom()
  const [searchParams] = useSearchParams()
  const [generated, setGenerated] = useState<{ type: ReportType; at: string } | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState(searchParams.get('student') ?? students[0]?.id ?? '')

  useEffect(() => {
    const studentParam = searchParams.get('student')
    if (studentParam) {
      setSelectedStudentId(studentParam)
      setGenerated({ type: 'individual', at: new Date().toLocaleTimeString('th-TH') })
    }
  }, [searchParams])

  function handleGenerate(type: ReportType) {
    setGenerated({ type, at: new Date().toLocaleTimeString('th-TH') })
  }

  const selectedStudent = students.find((s) => s.id === selectedStudentId) ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">รายงาน</h1>
        <p className="mt-1 text-sm text-muted-foreground">เลือกประเภทรายงานที่ต้องการสร้าง (เดโม — ยังไม่มีการสร้าง PDF จริง)</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {REPORT_TYPES.map((report) => (
          <Card key={report.type}>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <report.icon className="size-4" />
              </div>
              <CardTitle className="text-base">{report.title}</CardTitle>
              <CardDescription>{report.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={() => handleGenerate(report.type)}>
                สร้างรายงาน
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {generated && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">
                ตัวอย่างรายงาน: {REPORT_TYPES.find((r) => r.type === generated.type)?.title}
              </CardTitle>
              <CardDescription>สร้างเมื่อ {generated.at}</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled title="ฟีเจอร์นี้จะพร้อมใช้งานเร็วๆ นี้">
              <Download className="size-3.5" />
              ดาวน์โหลด PDF (เร็วๆ นี้)
            </Button>
          </CardHeader>
          <CardContent>
            {generated.type === 'attendance' && (
              <div className="space-y-2 text-sm">
                {ATTENDANCE_STATUS_ORDER.map((status) => (
                  <div key={status} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                    <span className="text-muted-foreground">{ATTENDANCE_STATUS_LABEL[status]}</span>
                    <span className="font-semibold">{attendanceSummary[status]} คน</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 text-sm font-semibold">
                  <span>รวมทั้งหมด</span>
                  <span>{attendanceSummary.total} คน</span>
                </div>
              </div>
            )}

            {generated.type === 'grades' && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">เฉลี่ยห้อง</p>
                    <p className="text-lg font-semibold">{gradeStats.classAverage.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">สูงสุด</p>
                    <p className="text-lg font-semibold text-success">{gradeStats.highest.toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ต่ำสุด</p>
                    <p className="text-lg font-semibold text-destructive">{gradeStats.lowest.toFixed(0)}</p>
                  </div>
                </div>
              </div>
            )}

            {generated.type === 'missing' && (
              <div className="space-y-2 text-sm">
                {students
                  .filter((s) => (missingByStudent[s.id] ?? 0) > 0)
                  .sort((a, b) => (missingByStudent[b.id] ?? 0) - (missingByStudent[a.id] ?? 0))
                  .map((s) => (
                    <div key={s.id} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                      <span>
                        {s.firstName} {s.lastName}
                      </span>
                      <Badge variant="warning">{missingByStudent[s.id]} งาน</Badge>
                    </div>
                  ))}
                {students.every((s) => (missingByStudent[s.id] ?? 0) === 0) && (
                  <p className="text-muted-foreground">ไม่มีนักเรียนที่มีงานค้าง</p>
                )}
              </div>
            )}

            {generated.type === 'individual' && (
              <div className="space-y-3">
                <NativeSelect
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full sm:w-64"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.number}. {s.firstName} {s.lastName}
                    </option>
                  ))}
                </NativeSelect>

                {selectedStudent && (
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">รหัสนักเรียน</p>
                      <p className="font-semibold">{selectedStudent.studentCode}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">คะแนนรวม</p>
                      <p className="font-semibold">
                        {grades[selectedStudent.id] ? computeTotal(grades[selectedStudent.id]) : 0}/100
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">งานค้าง</p>
                      <p className="font-semibold">{missingByStudent[selectedStudent.id] ?? 0} งาน</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
