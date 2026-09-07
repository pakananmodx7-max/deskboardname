interface HeaderRowPickerProps {
  rows: string[][]
  selectedIndex: number
  onSelect: (index: number) => void
}

/**
 * Shown when detectHeaderRow isn't confident enough to pick automatically
 * — a preview of the first rows of the file so the teacher can point at
 * whichever one is actually the column-header row (school name / class /
 * academic year title rows and blank spacer rows are common above it in
 * real school spreadsheets).
 */
export function HeaderRowPicker({ rows, selectedIndex, onSelect }: HeaderRowPickerProps) {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1)

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        ระบบไม่แน่ใจว่าแถวใดคือหัวตาราง กรุณาเลือกแถวที่มีชื่อคอลัมน์ (เช่น เลขที่, ชื่อ, นามสกุล)
      </p>
      <div className="max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((row, index) => {
              const isSelected = index === selectedIndex
              const isBlank = row.every((cell) => cell.trim() === '')
              return (
                <tr
                  key={index}
                  onClick={() => onSelect(index)}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/50 ${
                    isSelected ? 'bg-primary/10' : ''
                  }`}
                >
                  <td className="w-10 px-2 py-1.5 align-top">
                    <input
                      type="radio"
                      name="header-row"
                      checked={isSelected}
                      onChange={() => onSelect(index)}
                      aria-label={`เลือกแถวที่ ${index + 1} เป็นหัวตาราง`}
                    />
                  </td>
                  <td className="w-14 px-1 py-1.5 align-top text-xs text-muted-foreground">แถวที่ {index + 1}</td>
                  {isBlank ? (
                    <td colSpan={columnCount} className="px-2 py-1.5 italic text-muted-foreground">
                      (แถวว่าง)
                    </td>
                  ) : (
                    Array.from({ length: columnCount }, (_, colIndex) => (
                      <td key={colIndex} className="max-w-32 truncate px-2 py-1.5">
                        {row[colIndex] || ''}
                      </td>
                    ))
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
