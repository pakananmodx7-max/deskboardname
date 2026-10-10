import { formatThaiDate, obligationStatusText, studentDisplayName, type MissingReport, type MissingReportMeta } from './missing-report-model'

/**
 * The formal A4 document (print preview + browser printing). Same report
 * object as the screen and the PDF/Word exports; layout/print rules are in
 * missing-report-document-css.ts.
 */
export function MissingReportDocument({ report, meta }: { report: MissingReport; meta: MissingReportMeta }) {
  const s = report.summary
  const multi = report.groups.length > 1
  const metaLines = [
    meta.schoolName,
    meta.teacherName ? `ครูผู้สอน ${meta.teacherName}` : null,
    `ห้องเรียน ${meta.classroomLabel} | รายวิชา ${meta.subjectLabel}`,
    `${meta.semesterLabel} | ${meta.periodLabel}`,
    meta.statusLabel !== 'งานค้างทั้งหมด' || meta.searchLabel ? [meta.statusLabel, meta.searchLabel].filter(Boolean).join(' | ') : null,
    `วันที่จัดทำรายงาน ${formatThaiDate(meta.generatedOn, 'long')}`,
  ].filter((line): line is string => Boolean(line))

  return (
    <article className="kc-doc kc-sheet" aria-label={meta.title} data-testid="missing-report-document">
      <h1>{meta.title}</h1>
      <p className="kc-center" style={{ margin: 0 }}>
        {meta.subtitle}
      </p>
      <div className="kc-meta">
        {metaLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <hr />

      <h2>สรุปภาพรวม</h2>
      <table>
        <thead>
          <tr>
            <th>นักเรียนทั้งหมด</th>
            <th>นักเรียนที่มีงานค้าง</th>
            <th>งานที่ยังไม่ส่ง</th>
            <th>งานที่ขาดส่ง</th>
          </tr>
        </thead>
        <tbody>
          <tr className="kc-strong">
            <td className="kc-num">{s.totalStudents} คน</td>
            <td className="kc-num">{s.studentsWithMissing} คน</td>
            <td className="kc-num">{s.pending} รายการ</td>
            <td className="kc-num">{s.overdue} รายการ</td>
          </tr>
        </tbody>
      </table>
      <p className="kc-note">หมายเหตุ: นักเรียนนับเป็นคน งานนับเป็นรายการ (นักเรียน × งาน) · “ส่งช้า” นับว่าส่งแล้ว</p>

      {report.students.length === 0 ? (
        <p className="kc-center" style={{ margin: '14pt 0' }}>
          ไม่มีงานค้างส่งตามเงื่อนไขที่เลือก
        </p>
      ) : (
        <>
          <h2>ตารางสรุปนักเรียนที่มีงานค้างส่ง</h2>
          <table>
            <colgroup>
              <col style={{ width: '9%' }} />
              <col />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>เลขที่</th>
                <th style={{ textAlign: 'left' }}>ชื่อ–นามสกุล</th>
                <th>ห้องเรียน</th>
                <th>ยังไม่ส่ง</th>
                <th>ขาดส่ง</th>
                <th>รวม</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <GroupRows key={group.classroomId} group={group} multi={multi} />
              ))}
              <tr className="kc-strong">
                <td colSpan={3}>รวมทั้งหมด ({s.studentsWithMissing} คน)</td>
                <td className="kc-num">{s.pending}</td>
                <td className="kc-num">{s.overdue}</td>
                <td className="kc-num">{s.totalObligations}</td>
              </tr>
            </tbody>
          </table>

          <h2>รายละเอียดงานค้างส่ง</h2>
          {report.groups.flatMap((group) =>
            group.students.map((student) => (
              <section key={`${group.classroomId}:${student.studentId}`} className="kc-student">
                <p style={{ margin: 0, fontWeight: 700 }}>
                  เลขที่ {student.number ?? '-'} — {studentDisplayName(student)}
                  {multi ? ` (ห้อง ${group.classroomName})` : ''}
                </p>
                <ol>
                  {student.obligations.map((o) => (
                    <li key={o.assignmentId}>
                      {o.assignmentTitle} ({o.subjectName}) — {obligationStatusText(o)}
                      {o.status !== 'no_due' && o.dueDate ? <span style={{ whiteSpace: 'nowrap' }}> · กำหนดส่ง {formatThaiDate(o.dueDate)}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            )),
          )}
        </>
      )}

      <div className="kc-signature">
        <p>ลงชื่อ ................................................ ผู้รายงาน</p>
        <p>{meta.teacherName ? `(${meta.teacherName})` : '(................................................)'}</p>
        <p>ตำแหน่ง ครูผู้สอน</p>
      </div>
    </article>
  )
}

function GroupRows({ group, multi }: { group: MissingReport['groups'][number]; multi: boolean }) {
  return (
    <>
      {multi && (
        <tr className="kc-strong">
          <td colSpan={6}>ห้อง {group.classroomName}</td>
        </tr>
      )}
      {group.students.map((student) => (
        <tr key={student.studentId}>
          <td className="kc-num">{student.number ?? '-'}</td>
          <td>{studentDisplayName(student)}</td>
          <td className="kc-num">{group.classroomName}</td>
          <td className="kc-num">{student.pending}</td>
          <td className="kc-num">{student.overdue}</td>
          <td className="kc-num" style={{ fontWeight: 700 }}>
            {student.total}
          </td>
        </tr>
      ))}
      {multi && (
        <tr className="kc-strong">
          <td colSpan={3}>
            รวมห้อง {group.classroomName} ({group.subtotal.students} คน)
          </td>
          <td className="kc-num">{group.subtotal.pending}</td>
          <td className="kc-num">{group.subtotal.overdue}</td>
          <td className="kc-num">{group.subtotal.total}</td>
        </tr>
      )}
    </>
  )
}
