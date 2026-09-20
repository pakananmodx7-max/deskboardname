# SGS Bridge (Prototype — Dry Run)

A local, unpacked Chrome extension (Manifest V3) that lets a teacher move
a KrunameClass assignment's scores toward the Thai SGS grading system
using the teacher's own already-open, already-logged-in SGS browser tab.

**This is Phase 1+2 of the SGS integration — real score-table wiring, but
still a safe, dry-run prototype: it currently performs NO automatic
writes to the live SGS page at all (see "LIVE DISCOVERY" below).**

## LIVE DISCOVERY: SGS auto-saves — no Save button, no bulk fill (yet)

A hands-on check of the real SGS score page overturned a load-bearing
assumption this prototype had been built on:

- Every score column's header has a **checkbox**. Checking it is what
  makes that column's row inputs editable; unchecked columns' inputs are
  rendered `disabled`.
- The page itself says: *"Page นี้ใช้ระบบบันทึกอัตโนมัติ ไม่ต้องคลิกปุ่ม
  Save"* — **there is no Save button, and a write may persist to SGS the
  instant it happens.**

That second fact broke the original "fill a column → teacher reviews →
teacher clicks Save" safety model: on a page with no undo step, filling
many cells at once is not something this prototype should ever do
without much narrower, explicitly-confirmed control. Two changes follow:

1. **Three-way column classification, not two.** A score column can now
   be `writableScoreColumns` (checkbox checked, inputs actually enabled
   right now), `activatableScoreColumns` (a REAL score column, currently
   disabled ONLY because its header checkbox is unchecked — never
   reported as if it were a calculated field), or `derivedColumns`
   (genuinely calculated/status — รวมตลอดภาค, %, ปกติ, แก้ตัว, เรียนซ้ำ,
   Remark, ...). See `classifyScoreColumns` / `scanScoreColumnState` in
   `src/lib/sgs-table-extraction.js`. This extension never checks/toggles
   an SGS header checkbox itself — for an activatable column it only ever
   shows "กรุณาติ๊กเปิดช่องคะแนนนี้ใน SGS ก่อน" and a "สแกนใหม่" button so
   the teacher can check it by hand and have the Bridge re-scan.
2. **Bulk real fill has been removed.** Section 4 of the popup is now
   detection + student mapping + a READ-ONLY preview (existing SGS value
   vs. proposed value) — it never writes anything. In its place, section
   5 scaffolds a much narrower **"ทดสอบ 1 คน" (test one student)** mode:
   pick exactly one student and one column, see current/proposed values,
   and a write path that can only ever touch that ONE cell
   (`buildSingleCellTestPlan` in `src/lib/single-cell-test.js` guarantees
   `writesByOffset` never contains more than one entry). Its confirm
   button and checkbox ship **permanently disabled with no click
   listener at all** — intentionally not wired up yet, pending detection
   being revalidated against the live page.

## What this extension does NOT do

- Does not ask for, store, or transmit an SGS username/password.
- Does not read or store SGS session cookies.
- Does not connect to any database directly (SGS's or KrunameClass's).
- Does not perform any automatic write to the live SGS page in this
  phase — see "LIVE DISCOVERY" above. Section 4's preview only ever
  READS existing values; section 5's single-cell test mode is built but
  its write button stays disabled and unwired.
- Never clicks or toggles a Save/Submit button, or an SGS header
  checkbox — the one thing this prototype could someday write (a single
  confirmed cell) only ever sets that cell's value and dispatches
  `input`/`change` events; nothing here ever looks for, or clicks, any
  other control on the page.
- Does not write to more than one SGS score column per operation, and
  never touches any column other than the one the teacher confirmed —
  see "Column-specific fill" and "Phase 2: real SGS table wiring" below.
- Does not invent CSS selectors for the score inputs themselves. The
  score table, its rows, and its columns are all found by inspecting
  the page's actual structure at runtime (see below) — the only
  selectors treated as fixed, known values are the two the teacher
  confirmed against the real page (`KNOWN_SGS_FILTER_IDS` in
  `src/content-diagnostic.js`), and even those are only ever read for
  diagnostic labeling, never used to decide anything about the score
  table.
- Does not send anything over the network — every chrome.storage write
  is local to the browser (`storage.session`/`storage.local`, never
  `storage.sync`).
- Does not request broad host permissions. It only ever touches the
  currently active tab, and only after the teacher explicitly clicks
  the extension's toolbar icon or one of its buttons (`activeTab` +
  `scripting`, no `<all_urls>`, no `host_permissions` at all).

## How KrunameClass hands data to this extension

There is no direct messaging channel between the KrunameClass web app
and this extension (deliberately — that would require trusting the
KrunameClass origin from inside the extension, which this prototype
phase doesn't need). Instead:

1. In KrunameClass, the teacher downloads a small `.json` "bridge
   payload" file from ONE of two independent places:
   - An assignment's detail page: **"ส่งคะแนนไป SGS"** → **"เตรียมส่งผ่าน
     SGS Bridge"** (`src/types/sgs-bridge.ts`'s `SgsBridgePayload`, no
     `kind` field — the original, assignment-scoped format).
   - The **"คะแนน SGS"** tab of a subject+classroom workspace (a
     completely independent grade model, never an assignment — see
     `docs/DATABASE.md` Phase 16): **"ส่งไป SGS"** → pick one column →
     **"ดาวน์โหลด Bridge Payload"** (`src/types/sgs-score-workspace.ts`'s
     `SgsScoreWorkspacePayload`, `kind: 'sgs_score_workspace'`).
2. In this extension's popup, the teacher picks that same file with the
   file input under "1. โหลด Bridge Payload จาก KrunameClass" — either
   file works interchangeably from this point on.
3. The extension re-validates the file from scratch
   (`src/lib/payload-validation.js`'s `validateAnySgsBridgePayload`,
   which dispatches on the file's `kind` field — a payload missing
   `kind` entirely is treated as the legacy assignment-scoped format)
   before trusting anything in it — never assumes a file on disk is safe
   just because KrunameClass produced it. Both formats are then
   normalized (`popup.js`'s `normalizeLoadedPayload`) into the same
   internal shape, so every later step (real-page inspection, column
   matching, mapping, preview, the single-cell test) works identically
   regardless of which page the file came from.

## Column-specific fill

Every bridge payload (v2+) is scoped to exactly ONE SGS score column,
chosen by the teacher in KrunameClass's "เลือกช่องคะแนน SGS" picker
before the file is even downloaded (`targetColumn` in the payload — see
`src/types/sgs-bridge.ts` on the KrunameClass side). `targetColumn.key`
is only a placeholder id from KrunameClass's own example column list —
see "Phase 2" below for how it's resolved to a REAL column on the page.

- Never lets a payload through validation without a `targetColumn`
  (`key`/`label`/`maxScore`) and an explicit `overwriteMode`
  (`skip_existing` or `overwrite_selected_column`) — see
  `src/lib/payload-validation.js`.
- The core skip/write RULE (a blank KrunameClass score is always
  skipped, an explicit `0` is always preserved, and an already-filled
  cell is only overwritten when the teacher chose
  `overwrite_selected_column`) is implemented twice, for two different
  situations:
  - `computeSgsColumnFillPlan` (`src/lib/column-fill.js`) — used when
    there's no real SGS data yet (the popup's payload-only preview,
    before "ตรวจสอบตารางคะแนน SGS จริง" has run).
  - `computeSgsRealFillPlan` (`src/lib/sgs-real-fill.js`) — the SAME
    rule, but additionally gated on student mapping: a student SGS
    can't confidently place (`AMBIGUOUS`/`NOT_FOUND`) is NEVER written,
    whatever their KrunameClass score is.
- Both turn their plan into "what to write" with a `buildSgs*WriteInstructions(plan, columnKey)`
  function that **only ever tags instructions with the one `columnKey`
  it was called with** — see `tests/column-fill.test.ts`'s and
  `tests/sgs-real-fill.test.ts`'s "selecting one column never modifies
  another" cases.

## Phase 2: real SGS table wiring

### The bug the first version of this had

The first cut of Phase 2 tried to find the student grid by matching
TABLE HEADER TEXT against a few Thai keywords (เลขที่/รหัส/ชื่อ), and read
the two known filters with `getElementById('...Filter_Input')`. Against
the real SGS page — an old ASP.NET page with ~200 nested layout tables —
neither worked:

- The header-keyword search never matched anything real, because the
  grid's headers don't line up with those exact keywords the way the
  heuristic assumed, and it never looked at the ROWS at all.
- `ctl00_PageContent_ClassSubjectIDFilter.Filter_Input` is a CSS
  SELECTOR (`select#ctl00_PageContent_ClassSubjectIDFilter.Filter_Input`
  — an id plus a class), not a literal element id. Appending
  `.Filter_Input` onto the string passed to `getElementById` could never
  match anything, so `knownFilters.subject.present` (and classroom's)
  was always `false`.

Both are fixed now — see `KNOWN_SGS_FILTER_IDS` in
`src/content-diagnostic.js` (bare ids: `ctl00_PageContent_ClassSubjectIDFilter`
/ `ctl00_PageContent_ClassSectionNoFilter`) and the row-structure
detection below.

### How the real student grid is located now

Once the teacher has loaded a bridge payload, clicking **"ตรวจสอบตารางคะแนน
SGS จริง"** (section 4 of the popup) runs the following, entirely derived
from the live page's own structure — nothing here hardcodes a score-input
selector, and no single top-level `<table>` is ever assumed to be the
grid:

1. **Read raw structure only** — `collectAllTableRowFacts` (injected)
   walks every `<table>` on the page and records, for every row, only
   its cell COUNT and which cells contain an input, plus the TEXT of
   non-input cells (capped in count/length for safety). It never reads
   an input's value here. Because `table.rows` only ever contains a
   table's OWN rows (a nested `<table>` inside one of its cells is a
   separate entry in the results, with its own `.rows`), the deepest
   grid nested inside layout tables shows up as its own clean, short
   list of rows — no special nesting logic is needed.
2. **Find the real grid by SHAPE, not content** — `findRepeatingRowRun`
   (`src/lib/sgs-table-extraction.js`) looks for the longest run of
   CONSECUTIVE rows that all have the identical shape (same cell count,
   inputs in the same positions) and actually contain at least one
   input — this is what "a real student row resembles the row before
   and after it" becomes in code, and why a long run of matching but
   input-less spacer rows never wins.
3. **Classify เลขที่/รหัสนักเรียน/ชื่อ-นามสกุล by CONTENT** —
   `classifyIdentifierColumns` looks at the actual text in that run's
   non-input columns: an all-numeric column is เลขที่ (the shorter one)
   or รหัสนักเรียน (the longer/zero-padded one); a column containing Thai
   characters is ชื่อ-นามสกุล. Header text is never consulted for this —
   only content, and only columns appearing BEFORE the first score
   input.
4. **Detect score columns, trace MULTI-ROW headers, and split writable
   vs. derived** — every OTHER input column in the run is a score-column
   candidate. `traceColumnHeaderTexts` walks UP through several rows
   above the run (real SGS headers can spread a column's number/name and
   its max score across more than one row), and `deriveScoreColumnHeader`
   takes the text CLOSEST to the data as the `label` (e.g. "10",
   "กลางภาค") and looks for a max score in the OTHER traced rows first —
   so a bare numeric label like "10" is never also reported as its own
   max score. A max score is only accepted if it's a plausible 1-100
   value AND the header doesn't match `REJECT_HEADER_KEYWORDS`
   (ปีการศึกษา, ชั้น, menu/language/login/logout labels).

   Each candidate column is then checked for real editability
   (`analyzeColumnRowInputState`, item 6 of the live-discovery fix): every
   row's ACTUAL VISIBLE input (never a hidden/cloned sibling control,
   never the outer table, never a header element) must be one visible
   `text`/`number` control per row. Combined with `findHeaderCheckboxState`
   (does this column's header hold a checkbox, and is it checked?), a
   column lands in exactly one of three buckets:
   - `writableScoreColumns` — checkbox checked (or none exists) AND the
     row inputs are actually enabled right now.
   - `activatableScoreColumns` — a REAL score column that's merely
     disabled because its header checkbox is unchecked (`reason:
     'header_checkbox_unchecked'`) or otherwise disabled
     (`'disabled_input'`) — **never** classified as derived just because
     it's currently disabled.
   - `derivedColumns` — rejected by LABEL (`isDerivedColumnLabel`: รวม/
     ตลอดภาค, %/เปอร์เซ็นต์/ร้อยละ, เกรด/GPA/ผลการเรียน, ปกติ/แก้ตัว/
     เรียนซ้ำ/Remark), has no input at all, isn't uniformly one input per
     row, or is `readOnly` (a computed value shown read-only — unlike
     `disabled`, checking/unchecking the header checkbox never toggles
     `readOnly` on the live page, so a readonly input is never merely
     "not activated yet").

   See `classifyScoreColumns` / `scanScoreColumnState` in
   `src/lib/sgs-table-extraction.js`.
5. **Rank every table's candidate** — `pickBestStudentGridCandidate`
   scores each table that has a qualifying run (row count, whether all
   three identifier columns were found, how many WRITABLE score columns
   it has) and picks the single best one, so ~200 candidate/layout
   tables around the real grid are never confused with it.
6. **Resolve the teacher's chosen column** — `matchTargetColumnToRealColumns`
   compares the payload's `targetColumn.label` against the winning
   table's `writableScoreColumns` ONLY — an `activatableScoreColumns` or
   `derivedColumns` entry can never even be matched or selected, whatever
   its label says. Exactly one label match auto-selects it; zero or more
   than one shows a warning and requires the teacher to pick the correct
   radio button by hand — the same "never silently guess" rule this
   bridge already applies to student matching. The popup lists every
   `activatableScoreColumns` entry with the exact "กรุณาติ๊กเปิดช่องคะแนนนี้
   ใน SGS ก่อน" workflow message and a "สแกนใหม่" re-scan button, and every
   `derivedColumns` entry read-only with its exclusion reason — purely
   for the teacher's own transparency.
7. **Read the target column's existing values** — `readColumnValues`
   (injected), given the CONFIRMED table index and row range from step
   5, reads only that one column's current cell values — never any
   other column's, and never before confirmation.
8. **Map students** — the run's identifier-column text (already read in
   step 1, no extra DOM call) becomes `sgsCandidates` for the existing
   `matchStudentsToSgs` (`src/lib/mapping.js`, unchanged), producing
   `MATCHED`/`AMBIGUOUS`/`NOT_FOUND` per student.
9. **Read-only preview** — เลขที่ | นักเรียน | คะแนน KrunameClass |
   คะแนนเดิม SGS | คะแนนใหม่ (ตัวอย่าง) (plus a mapping-status column),
   computed by `computeSgsRealFillPlan`. `gridMeetsFillRequirements` /
   `isConfirmedColumnWritable` gate whether a column may even be
   previewed at all (grid found, เลขที่/รหัส/ชื่อ ALL identified, the
   confirmed column actually in `writableScoreColumns` — never a
   derived/activatable column that merely happened to be displayed) —
   but per the LIVE DISCOVERY above, **nothing in this preview ever
   writes anything**; there is no bulk fill button anymore.
10. **"ทดสอบ 1 คน" single-cell test (section 5, scaffolded but inert)** —
    once the preview above succeeds, pickers for ONE student and ONE
    writable column are populated; clicking "แสดงตัวอย่าง 1 ช่อง" reads
    that ONE cell's current value (`readColumnValues` with `runLength: 1`
    at the student's row offset — never a range) and builds a plan via
    `buildSingleCellTestPlan`, which guarantees `writesByOffset` can never
    contain more than the one requested offset. The actual "ยืนยันทดลอง
    เขียน 1 ช่อง" button and its confirmation checkbox are **permanently
    disabled with no click listener wired up in popup.js at all** — by
    design, until detection has been revalidated against the live page.

### Pagination (best-effort, never automatic)

`detectPagination` (`src/lib/sgs-table-extraction.js`) looks for a
"pager row" elsewhere on the page — a row with no inputs where every
non-empty cell is a short (1-3 digit) page-number-looking string, never
the accepted student run itself. When found, it reports `currentPage`
only if exactly one of those cells isn't a link (the common ASP.NET
GridView convention: every OTHER page is a link, the current one is
plain text) — more or fewer than one non-link cell means `currentPage`
stays `null` rather than a guess. `totalPages` is the largest number
seen in that row. This never changes the page — it only tells the
teacher whether `studentRowCount` likely means "the whole classroom" or
"one page of it."

Every step here that runs INSIDE the SGS page
(`collectAllTableRowFacts`, `readColumnValues`, `fillSgsColumnValues`)
is a plain, closure-free function passed to
`chrome.scripting.executeScript({ func })` — Chrome serializes and
re-runs it standalone in the page with no access to this extension's
other files or each other. That's why the actual GRID-FINDING logic
(steps 2-6, and the anonymized debug/compact report builders) lives in
`src/lib/sgs-table-extraction.js` and `src/lib/diagnostic-report.js`
instead — imported normally by popup.js, which fully supports ES
modules — rather than being duplicated across multiple injected
functions the way the (much smaller) known-filter read is.

### The two known selectors

Two elements were confirmed against the real SGS page and are used
directly (never guessed): the subject and classroom filter `<select>`s,
with ids `ctl00_PageContent_ClassSubjectIDFilter` and
`ctl00_PageContent_ClassSectionNoFilter` (read via `getElementById` — a
literal id lookup, no CSS-selector escaping needed). They're used only
to label a diagnostic capture with which subject/classroom it came
from, reading both `.value` and the selected `<option>`'s visible text,
and never changing the selection; nothing about the score table itself
depends on them.

## Current functions

1. **Connection status** — "พบหน้า SGS" / "กรุณาเปิดหน้า SGS", based on
   a teacher-configurable keyword checked against the active tab's
   title/URL (Options page) — a simple heuristic, not a hardcoded
   domain, since page URLs can vary across schools' SGS deployments.
2. **Load + preview a bridge payload** — subject, classroom, assignment,
   the ONE target SGS column and its max score, the chosen overwrite
   mode, student count, and the full column-fill table (existing/new
   value per student — existing value is always "ว่าง" here, since this
   preview has no live SGS connection; see step 4 below for the real
   one).
3. **"ตรวจสอบการจับคู่นักเรียน" (payload-only mapping dry run)** — runs
   the mapping algorithm against an empty SGS-candidate list (no live
   page read here) so a teacher can see the algorithm/UI before running
   the real inspection in step 4.
4. **"ตรวจสอบตารางคะแนน SGS จริง"** — detection, column matching, and a
   READ-ONLY preview (no bulk write — see "LIVE DISCOVERY" above), plus
   the still-scaffolded-but-disabled "ทดสอบ 1 คน" single-cell test mode.
5. **"ตรวจสอบโครงสร้างหน้า SGS" — three diagnostic modes, one output box**:
   - **แบบย่อ (compact, the primary one)** — `collectAllTableRowFacts` +
     `buildCompactStudentGridReport`: `pageTitle`, `pageUrl`,
     `subjectFilter`, `classroomFilter`, `studentGrid` (found/columns/
     `writableScoreColumns`/`activatableScoreColumns`/`derivedColumns`),
     `pagination`, `confidence`, `warnings` — no per-table dump, and
     never a student's actual name/code.
   - **แบบละเอียด (debug, anonymized)** — the compact report plus
     `debugRows`: per-row `{rowIndex, cellCount, textCellIndexes,
     inputCellIndexes, inputCount, probableNumberCell,
     probableStudentCodeCell, probableNameCell}` for the winning table's
     rows only, still with no actual student text.
   - **โหมดข้อมูลดิบ (verbose)** — the OLD raw dump
     (`collectRawSgsFacts`/`buildDiagnosticReport`): every table's row
     count/header text/input-type counts, kept only as a debugging
     fallback.

   Meant to be run once per distinct SGS page/subject/classroom (~18
   expected) so every capture is directly comparable.

## Loading the extension locally

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top-right toggle).
3. Click "Load unpacked" and select this `sgs-bridge/` folder.
4. Pin the extension for easy access (optional).

No build step is required — every file is plain HTML/CSS/JS, loaded
as-is.

## Running the diagnostic mode

1. Open the actual SGS page in a tab (log in as usual — this extension
   never touches that login).
2. Click the extension's toolbar icon.
3. Under "5. ตรวจสอบโครงสร้างหน้า SGS", click the button.
4. Click "คัดลอกผลลัพธ์" and paste the JSON back for cataloging.

## Running the real-page inspection (detection + read-only preview only)

1. Load a bridge payload (section 1).
2. Open the real SGS score-entry page for the matching subject/classroom
   in the active tab.
3. Under "4. จับคู่กับตารางคะแนนจริงใน SGS", click "ตรวจสอบตารางคะแนน SGS
   จริง".
4. Confirm the highlighted column matches the teacher's intended target
   (or pick the correct one manually if the automatic match didn't
   succeed). If the intended column shows up under "ยังไม่ได้เปิดใช้งานใน
   SGS" instead, manually check that column's header checkbox in SGS,
   then click "สแกนใหม่".
5. Review the read-only preview table — **this is where it stops.** There
   is no bulk fill button. Per the LIVE DISCOVERY above, SGS auto-saves
   with no Save button, so this prototype does not perform any automatic
   write to the live page yet.
6. Section 5 ("ทดสอบ 1 คน") lets you pick one student and one column and
   preview a single cell's current/proposed value, but its write-confirm
   button is intentionally disabled and has no click handler wired up —
   it is scaffolding for a future phase, not a usable action yet.

## Tests

The extension's logic lives in dependency-free ES modules under
`src/lib/` (plus `src/content-diagnostic.js`, whose DOM-walking is kept
separate from the pure functions it feeds). These have zero external
dependencies, so their tests (`tests/*.test.ts`) run directly from the
repo root's own Vitest suite (`npm test` at the repo root) rather than
needing a second `npm install` — unlike `mcp-bridge/`, which has real
runtime dependencies and is a fully separate Node package.

## Future phases (not built yet)

- Phase 3+: once this has been run against real SGS pages, adjust
  `classifyIdentifierColumns`/`REJECT_HEADER_KEYWORDS`/the
  `looksLikeStudentRowFingerprint`/`minRunLength` thresholds in
  `src/lib/sgs-table-extraction.js` for anything the real pages' rows use
  that this prototype didn't anticipate, using the diagnostic captures
  collected via "ตรวจสอบโครงสร้างหน้า SGS".
- **Superseded by the LIVE DISCOVERY above:** the earlier plan here was
  "DRY RUN → Preview → teacher confirmation → fill the SGS form → teacher
  reviews SGS → final SGS Save." That assumed a Save step existed to
  review against; the real page auto-saves with no Save button, so that
  plan is no longer the target architecture.
- Next actual step: validate the header-checkbox/visible-input detection
  above against a real SGS page (via "ตรวจสอบโครงสร้างหน้า SGS"), THEN
  deliberately enable the single-cell test mode's write button (section
  5) — one explicit, reviewed change, never bundled with an unrelated
  fix. Only once that single-cell path has been proven safe on a real
  page should a much more conservative bulk-fill design (if any) be
  reconsidered — never a return to the old "fill the whole column" flow.
