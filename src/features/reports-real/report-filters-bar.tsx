import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import type { ReportFilterOptions } from '@/services/report-service'
import type { ReportFilters } from '@/types/report'

interface ReportFiltersBarProps {
  filters: ReportFilters
  options: ReportFilterOptions
  onChange: (filters: ReportFilters) => void
}

/** Shared filter bar for every report tab — classroom/subject narrow an
 * already-teacher-scoped query (see report-service.ts), date range is
 * always set (defaults to the last 30 days). Changing any field here
 * re-fetches whichever report tab is active. */
export function ReportFiltersBar({ filters, options, onChange }: ReportFiltersBarProps) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-5">
        <div className="space-y-1.5">
          <Label htmlFor="report-filter-classroom">ห้องเรียน</Label>
          <NativeSelect
            id="report-filter-classroom"
            className="w-48"
            value={filters.classroomId ?? ''}
            onChange={(e) => onChange({ ...filters, classroomId: e.target.value || null })}
          >
            <option value="">ทุกห้องเรียน</option>
            {options.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-filter-subject">วิชา</Label>
          <NativeSelect
            id="report-filter-subject"
            className="w-48"
            value={filters.subjectId ?? ''}
            onChange={(e) => onChange({ ...filters, subjectId: e.target.value || null })}
          >
            <option value="">ทุกวิชา</option>
            {options.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-filter-start">ตั้งแต่วันที่</Label>
          <Input
            id="report-filter-start"
            type="date"
            className="w-auto"
            value={filters.startDate}
            max={filters.endDate}
            onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-filter-end">ถึงวันที่</Label>
          <Input
            id="report-filter-end"
            type="date"
            className="w-auto"
            value={filters.endDate}
            min={filters.startDate}
            onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  )
}
