import { formatThaiDate } from '@/features/reports-missing/missing-report-model'

import { attendanceMetaLines, BAND_LABEL, formatRate, STATUS_LABEL, type AttendanceReport, type AttendanceReportMeta } from './attendance-report-model'

/**
 * The formal A4 attendance document (print preview + browser printing).
 * Same report object as the screen and the PDF/Word exports; print rules
 * (A4 portrait, 20 mm margins, page numbers, repeating headers, rows not
 * split, black-and-white) come from the shared report document CSS.
 */
export function AttendanceReportDocument({ report, meta }: { report: AttendanceReport; meta: AttendanceReportMeta }) {
  const s = report.summary
  const pct = (n: number) => (s.total > 0 ? ` (${((n / s.total) * 100).toFixed(1)}%)` : '')
  const flagged = report.students.filter((r) => r.followUp)

  return (
    <article className="kc-doc kc-sheet" aria-label={meta.title} data-testid="attendance-report-document">
      <h1>{meta.title}</h1>
      <p className="kc-center" style={{ margin: 0 }}>
        {meta.subtitle}
      </p>
      <div className="kc-meta">
        {attendanceMetaLines(meta).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <hr />

      <h2>สรุปภาพรวม</h2>
      <table>
        <thead>
          <tr>
            <th>นักเรียนทั้งหมด</th>
            <th>มาเรียน</th>
            <th>มาสาย</th>
            <th>ลา</th>
            <th>ขาดเรียน</th>
          </tr>
        </thead>
        <tbody>
          <tr className="kc-strong">
            <td className="kc-num">{s.uniqueStudents} คน</td>
            <td className="kc-num">
              {s.present} ครั้ง{pct(s.present)}
            </td>
            <td className="kc-num">
              {s.late} ครั้ง{pct(s.late)}
            </td>
            <td className="kc-num">
              {s.leave} ครั้ง{pct(s.leave)}
            </td>
            <td className="kc-num">
              {s.absent} ครั้ง{pct(s.absent)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="kc-note">
        นักเรียนนับเป็นคน (ไม่นับซ้ำ) · สถานะนับเป็นรายการเช็คชื่อ (ครั้ง) · ร้อยละคิดจากรายการเช็คชื่อทั้งหมด {s.total} รายการ จากการเช็คชื่อ {s.sessions} ครั้ง · ร้อยละการมาเรียนรวม{' '}
        {formatRate(s.rate)}
      </p>

      {report.student ? (
        <>
          <h2>
            นักเรียน: เลขที่ {report.student.row.number ?? '-'} {report.student.row.firstName} {report.student.row.lastName} · ห้อง {report.student.row.classroomNames.join(', ')}
          </h2>
          <p style={{ margin: 0 }}>
            มาเรียน {report.student.row.present} · มาสาย {report.student.row.late} · ลา {report.student.row.leave} · ขาดเรียน {report.student.row.absent} · รวม {report.student.row.total} รายการ ·
            ร้อยละการมาเรียน {formatRate(report.student.row.rate)} ({BAND_LABEL[report.student.row.band]})
          </p>
          {report.student.row.followUp && <p style={{ margin: 0 }}>ควรติดตาม: {report.student.row.followUpReasons.join(' · ')}</p>}
          <h2>ประวัติการเช็คชื่อ</h2>
          {report.student.history.length === 0 ? (
            <p className="kc-center">ยังไม่มีบันทึกการเช็คชื่อในช่วงที่เลือก</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th style={{ textAlign: 'left' }}>รายวิชา</th>
                  <th>ห้องเรียน</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {report.student.history.map((h) => (
                  <tr key={h.sessionId}>
                    <td className="kc-num">{formatThaiDate(h.date)}</td>
                    <td>{h.subjectName ?? 'เช็คชื่อประจำวัน'}</td>
                    <td className="kc-num">{h.classroomName}</td>
                    <td className="kc-num">{STATUS_LABEL[h.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          {report.classrooms.length > 1 && !report.classroomDetail && (
            <>
              <h2>สรุปรายห้องเรียน</h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>ห้องเรียน</th>
                    <th>นักเรียน</th>
                    <th>ครั้งที่เช็ค</th>
                    <th>รายการเช็คชื่อ</th>
                    <th>% มาเรียน</th>
                    <th>ควรติดตาม</th>
                  </tr>
                </thead>
                <tbody>
                  {report.classrooms.map((c) => (
                    <tr key={c.classroomId}>
                      <td>{c.classroomName}</td>
                      <td className="kc-num">{c.students} คน</td>
                      <td className="kc-num">{c.sessions}</td>
                      <td className="kc-num">{c.total}</td>
                      <td className="kc-num">{formatRate(c.rate)}</td>
                      <td className="kc-num">{c.followUpCount} คน</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {report.classroomDetail && (
            <p style={{ margin: '6pt 0 0' }}>
              ห้อง {report.classroomDetail.classroomName}: นักเรียน {report.classroomDetail.students} คน · เช็คชื่อ {report.classroomDetail.sessions} ครั้ง · มาเรียนเฉลี่ย{' '}
              {formatRate(report.classroomDetail.rate)} · ควรติดตาม {report.classroomDetail.followUpCount} คน
            </p>
          )}

          <h2>ตารางการเข้าเรียนรายนักเรียน</h2>
          {report.students.length === 0 ? (
            <p className="kc-center">ไม่มีนักเรียนตามเงื่อนไขที่เลือก</p>
          ) : (
            <table style={{ fontSize: '11pt' }}>
              <colgroup>
                <col style={{ width: '7%' }} />
                <col />
                <col style={{ width: '10%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th style={{ textAlign: 'left' }}>ชื่อ–นามสกุล</th>
                  <th>ห้องเรียน</th>
                  <th>มา</th>
                  <th>สาย</th>
                  <th>ลา</th>
                  <th>ขาด</th>
                  <th>รวม</th>
                  <th>ร้อยละ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {report.students.map((r) => (
                  <tr key={r.studentId}>
                    <td className="kc-num">{r.number ?? '-'}</td>
                    <td>
                      {r.firstName} {r.lastName}
                      {r.followUp ? ' *' : ''}
                    </td>
                    <td className="kc-num">{r.classroomNames.join(', ')}</td>
                    <td className="kc-num">{r.present}</td>
                    <td className="kc-num">{r.late}</td>
                    <td className="kc-num">{r.leave}</td>
                    <td className="kc-num">{r.absent}</td>
                    <td className="kc-num" style={{ fontWeight: 700 }}>
                      {r.total}
                    </td>
                    <td className="kc-num">{r.rate === null ? '-' : `${r.rate.toFixed(1)}%`}</td>
                    <td className="kc-num">{BAND_LABEL[r.band]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="kc-note">* นักเรียนที่ควรติดตาม (ตัวบ่งชี้สำหรับครู ไม่ใช่การตัดสินผลการเรียน)</p>

          {flagged.length > 0 && (
            <section className="kc-student">
              <h2>นักเรียนที่ควรติดตาม</h2>
              <ol>
                {flagged.map((r) => (
                  <li key={r.studentId}>
                    เลขที่ {r.number ?? '-'} {r.firstName} {r.lastName} ({r.classroomNames.join(', ')}) — {r.followUpReasons.join(' · ')}
                  </li>
                ))}
              </ol>
            </section>
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
