# SGS Bridge (Prototype — Dry Run)

A local, unpacked Chrome extension (Manifest V3) that lets a teacher move
a KrunameClass assignment's scores toward the Thai SGS grading system
using the teacher's own already-open, already-logged-in SGS browser tab.

**This is Phase 1+2 of the SGS integration — real score-table wiring, but
still a safe, dry-run prototype: it never clicks Save/Submit in SGS.**

## What this extension does NOT do

- Does not ask for, store, or transmit an SGS username/password.
- Does not read or store SGS session cookies.
- Does not connect to any database directly (SGS's or KrunameClass's).
- Does not auto-fill or auto-click Save/Submit on the SGS page — filling
  a cell (once the teacher explicitly clicks "ทดลองกรอกเฉพาะช่องนี้")
  only ever sets that cell's value and dispatches `input`/`change`
  events; nothing here ever looks for, or clicks, a Save/Submit button.
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

1. In KrunameClass, on an assignment's detail page, the teacher clicks
   **"ส่งคะแนนไป SGS"**, reviews the preview dialog, and clicks
   **"เตรียมส่งผ่าน SGS Bridge"**. This downloads a small `.json` file
   (the "bridge payload") to their computer — see
   `src/types/sgs-bridge.ts` for its exact shape.
2. In this extension's popup, the teacher picks that same file with the
   file input under "1. โหลด Bridge Payload จาก KrunameClass".
3. The extension re-validates the file from scratch
   (`src/lib/payload-validation.js`) before trusting anything in it —
   never assumes a file on disk is safe just because KrunameClass
   produced it.

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

Once the teacher has loaded a bridge payload, clicking **"ตรวจสอบตารางคะแนน
SGS จริง"** (section 4 of the popup) runs the following, entirely derived
from the live page's own structure — nothing here hardcodes a score-input
selector:

1. **Detect the score table** — `inspectSgsScoreTable` (injected into the
   page) scores every `<table>` on structural signals (a recognizable
   เลขที่/รหัส/ชื่อ header, at least one input in its body rows) and picks
   the best match.
2. **Extract each student row** — for the chosen table, reads only the
   เลขที่/รหัสนักเรียน/ชื่อ-นามสกุล columns (identified by header keyword,
   never a fixed index).
3. **Detect score columns** — every OTHER column that actually contains
   an input is a score-column candidate;
   `identifyScoreColumnCandidates` (`src/lib/sgs-table-extraction.js`)
   derives a `{key, label, maxScore}` for each, parsing a max score out
   of the header text when present (e.g. "กลางภาค (10)" → `10`) and
   never guessing one when it isn't.
4. **Resolve the teacher's chosen column** —
   `matchTargetColumnToRealColumns` compares the payload's
   `targetColumn.label` against the real candidates' labels. Exactly one
   match auto-selects it; zero or more than one shows a warning and
   requires the teacher to pick the correct radio button by hand — the
   same "never silently guess" rule this bridge already applies to
   student matching.
5. **Read the target column's existing values** — a second
   `inspectSgsScoreTable` call, now with the confirmed column's index,
   reads only THAT column's current cell values (never any other
   column).
6. **Map students** — the extracted rows become `sgsCandidates` for the
   existing `matchStudentsToSgs` (`src/lib/mapping.js`, unchanged),
   producing `MATCHED`/`AMBIGUOUS`/`NOT_FOUND` per student.
7. **Preview** — เลขที่ | นักเรียน | คะแนน KrunameClass | คะแนนเดิม SGS |
   คะแนนใหม่ (plus a mapping-status column), computed by
   `computeSgsRealFillPlan`.
8. **Fill ONLY the confirmed column** — clicking **"ทดลองกรอกเฉพาะช่องนี้"**
   builds write instructions scoped to that one column
   (`buildSgsRealWriteInstructions`) and calls `fillSgsColumnValues`
   (injected), which sets `input.value` and dispatches `input`/`change`
   events for exactly those cells — never a different column's, and
   never a Save/Submit click.
9. **Result** — the five required buckets (matched / written / skipped
   no score / skipped existing / ambiguous-or-not-found), from
   `summarizeSgsRealFillPlan`, plus the DOM function's own reported
   count as a cross-check.

Every step here that runs INSIDE the SGS page (`inspectSgsScoreTable`,
`fillSgsColumnValues`) is a plain, closure-free function passed to
`chrome.scripting.executeScript({ func })` — Chrome serializes and
re-runs it standalone in the page with no access to this extension's
other files, which is why each one independently re-derives the same
table via the same small structural heuristic rather than sharing a
cached DOM reference across calls (see the file header comment in
`src/content-diagnostic.js`).

### The two known selectors

Two elements were confirmed against the real SGS page and are used
directly (never guessed): the subject and classroom filter inputs,
`ctl00_PageContent_ClassSubjectIDFilter.Filter_Input` and
`ctl00_PageContent_ClassSectionNoFilter.Filter_Input` — read via
`getElementById` (which takes the id string literally, dot included, so
no CSS-selector escaping is needed). They're used only to label a
diagnostic capture with which subject/classroom it came from; nothing
about the score table itself depends on them.

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
4. **"ตรวจสอบตารางคะแนน SGS จริง" / "ทดลองกรอกเฉพาะช่องนี้"** — the real
   Phase 2 workflow described above.
5. **"ตรวจสอบโครงสร้างหน้า SGS" (generic diagnostic)** — injects
   `collectRawSgsFacts` into the active tab (only on click) to collect
   page URL, form/table counts, row counts, input element *types* and
   *presence-per-column* (never values), safe CSS selector candidates,
   visible column header text, an identifier/score-column guess per
   table, and the two known filters' current selection. Never reads
   cookies, `localStorage`, or a data table's body-row text. The result
   is shown in a copyable text box — meant to be run once per distinct
   SGS page/subject/classroom (~18 expected) so every capture is
   directly comparable.

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

## Running the real column fill (dry run)

1. Load a bridge payload (section 1).
2. Open the real SGS score-entry page for the matching subject/classroom
   in the active tab.
3. Under "4. จับคู่กับตารางคะแนนจริงใน SGS", click "ตรวจสอบตารางคะแนน SGS
   จริง".
4. Confirm the highlighted column matches the teacher's intended target
   (or pick the correct one manually if the automatic match didn't
   succeed).
5. Review the preview table, then click "ทดลองกรอกเฉพาะช่องนี้".
6. **Check the result in SGS and click Save there yourself** — this
   extension never does that step for you.

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
  `identifyIdentifierColumns`/`identifyScoreColumnCandidates`'s keyword
  patterns for anything the real pages' headers use that this prototype
  didn't anticipate, using the diagnostic captures collected via
  "ตรวจสอบโครงสร้างหน้า SGS".
- Phase 7: DRY RUN → Preview → teacher confirmation → fill the SGS form
  → teacher reviews SGS → final SGS Save. This extension now reaches
  "fill the SGS form"; the final "click Save" step remains explicitly
  out of scope until requested and reviewed separately.
