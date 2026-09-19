/**
 * Phase 5 diagnostic collector — this is the ONLY file in this
 * extension that runs inside the SGS page itself (via
 * chrome.scripting.executeScript's `func`, triggered only when the
 * teacher clicks "ตรวจสอบโครงสร้างหน้า SGS", never automatically).
 *
 * Collects STRUCTURE only:
 *   - page URL / title
 *   - form and table counts
 *   - each table's row count, a safe CSS selector candidate
 *     (tag + id + first class — never an index into real data), and its
 *     VISIBLE header text (from <thead> or the first row)
 *   - every input/select/textarea's TYPE (never its current value) and
 *     a safe selector candidate for it
 *
 * Deliberately NEVER reads: document.cookie, localStorage,
 * sessionStorage, any input's `.value`, or any table BODY row's text
 * (only header cells) — there is no student personal data or SGS
 * credential this function could return even if asked to.
 *
 * `chrome.scripting.executeScript({ func: collectRawSgsFacts })`
 * serializes this function and re-runs it standalone inside the target
 * page, so it must not reference anything from its enclosing module
 * scope (no imports, no closures) — it only uses the global `document`/
 * `location` the target page already has.
 */
export function collectRawSgsFacts() {
  function selectorCandidateFor(el) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const firstClass = el.classList && el.classList.length > 0 ? `.${el.classList[0]}` : ''
    return `${tag}${id}${firstClass}`
  }

  const allTables = Array.from(document.querySelectorAll('table'))
  const tables = allTables.slice(0, 20).map((table) => {
    const rows = table.querySelectorAll('tr')
    const headerRow = table.querySelector('thead tr') || rows[0] || null
    const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th,td')).slice(0, 30) : []
    return {
      selectorCandidate: selectorCandidateFor(table),
      rowCount: rows.length,
      columnHeaders: headerCells.map((cell) => (cell.textContent || '').trim().slice(0, 60)),
    }
  })

  const inputTypeCounts = {}
  const inputSelectorCandidates = []
  Array.from(document.querySelectorAll('input,select,textarea'))
    .slice(0, 200)
    .forEach((el) => {
      const kind = el.tagName.toLowerCase() === 'input' ? el.getAttribute('type') || 'text' : el.tagName.toLowerCase()
      inputTypeCounts[kind] = (inputTypeCounts[kind] || 0) + 1
      if (inputSelectorCandidates.length < 20) {
        inputSelectorCandidates.push(selectorCandidateFor(el))
      }
    })

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    formCount: document.forms.length,
    tableCount: allTables.length,
    tables,
    inputTypeCounts,
    inputSelectorCandidates,
  }
}
