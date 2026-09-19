# SGS Bridge (Prototype — Dry Run)

A local, unpacked Chrome extension (Manifest V3) that lets a teacher move
a KrunameClass assignment's scores toward the Thai SGS grading system
using the teacher's own already-open, already-logged-in SGS browser tab.

**This is Phase 1 of the SGS integration. It is a safe, dry-run
prototype and stops well short of ever writing to SGS.**

## What this extension does NOT do

- Does not ask for, store, or transmit an SGS username/password.
- Does not read or store SGS session cookies.
- Does not connect to any database directly (SGS's or KrunameClass's).
- Does not auto-fill or auto-click Save/Submit on the SGS page.
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

## Current functions (Phase 1)

1. **Connection status** — "พบหน้า SGS" / "กรุณาเปิดหน้า SGS", based on
   a teacher-configurable keyword checked against the active tab's
   title/URL (Options page). The real SGS URL/DOM isn't known yet
   (Phase 5), so this deliberately stays a simple heuristic rather than
   a guessed domain match.
2. **Load + preview a bridge payload** — classroom, assignment, max
   score, student count, and the score table.
3. **"ตรวจสอบการจับคู่นักเรียน" (mapping dry run)** — runs the Phase 6
   mapping algorithm (`src/lib/mapping.js`) against the loaded payload.
   Because Phase 5's SGS selectors don't exist yet, this currently runs
   against an empty SGS-candidate list on purpose (never an invented
   selector), so every row honestly reports `NOT_FOUND` for now — the
   UI and algorithm are ready for the moment real SGS rows can be read.
4. **"ตรวจสอบโครงสร้างหน้า SGS" (Phase 5 diagnostic)** — injects
   `src/content-diagnostic.js` into the active tab (only on click) to
   collect page URL, form/table counts, row counts, input element
   *types* (never values), safe CSS selector candidates, and visible
   column header text. Never reads cookies, `localStorage`, or any
   input's actual value, and never reads a data table's body rows (only
   header cells). The result is shown in a copyable text box — paste it
   back to Claude to design Phase 2 (real SGS selectors).

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
3. Under "3. ตรวจสอบโครงสร้างหน้า SGS", click the button.
4. Click "คัดลอกผลลัพธ์" and paste the JSON back for the next phase of
   this project.

## Tests

The extension's logic lives in dependency-free ES modules under
`src/lib/` (plus `src/content-diagnostic.js`, whose DOM-walking is kept
separate from the pure `buildDiagnosticReport` formatter it feeds). These
have zero external dependencies, so their tests (`tests/*.test.ts`) run
directly from the repo root's own Vitest suite (`npm test` at the repo
root) rather than needing a second `npm install` — unlike `mcp-bridge/`,
which has real runtime dependencies and is a fully separate Node
package.

## Future phases (not built yet)

- Phase 2: once Phase 5's diagnostic output is available, design real,
  reviewed CSS selectors for SGS's actual score table and wire up a real
  `sgsCandidates` extractor for the mapping dry run.
- Phase 7: DRY RUN → Preview → teacher confirmation → fill the SGS form
  → teacher reviews SGS → final SGS Save. This extension currently stops
  at DRY RUN + mapping preview; filling or saving the SGS form is out of
  scope until that's explicitly requested and reviewed.
