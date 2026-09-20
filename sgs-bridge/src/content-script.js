/**
 * TRUE unattended auto-run — the in-page engine. Registered (manifest.json)
 * ONLY for https://sgs.bopp-obec.info/sgs/* — this file never runs on any
 * other site. Its job is exactly item 2's list: detect SGS score page
 * state, read the current page/grid, perform already-approved score
 * writes, detect pagination, and resume an active approved run after an
 * SGS reload/postback. It never collects a password, a cookie, or an
 * auth token — every DOM read here goes through content-diagnostic.js's
 * already-existing, already-audited functions (collectAllTableRowFacts,
 * readColumnValues, fillSgsColumnValues, readSingleColumnCellValue,
 * inspectPaginationControls, clickPaginationControl, readGridFingerprint),
 * none of which ever reads document.cookie/localStorage/sessionStorage or
 * any input this run wasn't explicitly told to touch.
 *
 * This is a CLASSIC script (manifest content_scripts entries have no
 * "type": "module" field — only background service workers do), so it
 * never uses static `import` syntax. Every pure/DOM-touching module this
 * codebase already has is instead loaded via a dynamic `import()` of the
 * extension's own bundled file — a well-established pattern for reusing
 * ES modules from a non-module content script — which is why each of
 * those files is listed under manifest.json's `web_accessible_resources`
 * (scoped to this SAME SGS host, never a broader match). A dynamic
 * import()'d module still executes in this content script's own isolated
 * world, so `document` inside it is the REAL, live SGS page — exactly
 * what content-diagnostic.js's functions were already written to expect
 * (see that file's own header on being callable directly, not only via
 * `chrome.scripting.executeScript`).
 *
 * background.js is the single source of truth for run state; this file
 * never persists anything on its own. Every one-page pipeline run here
 * ends by reporting an outcome message (AR_PAGE_COMPLETE, AR_MANUAL_PAUSE,
 * AR_ABORT, AR_STOPPED, or AR_COMPLETE per pagination-control.js's kinds)
 * and, if there was a page to advance to, an AR_PENDING_ADVANCE BEFORE the
 * click — because a real ASP.NET full-page postback destroys THIS SCRIPT
 * INSTANCE's own execution context the moment the click fires, exactly
 * like the previous popup-driven loop's own two-separate-executeScript-
 * calls design (see pagination-control.js's own doc comment). The fresh
 * content-script instance that the manifest auto-injects into the newly
 * loaded page is what performs the actual post-click verification, via
 * `AR_CHECK_ACTIVE`'s own `pendingAdvance` field — never this instance,
 * which cannot be relied on to still exist by the time verification would
 * run. A short in-place fallback verification is still attempted in case
 * the postback turns out to be non-destructive (e.g. an UpdatePanel-style
 * partial update) — a bonus path, never the one this design depends on.
 */

;(function () {
  'use strict'

  // A content script can, in rare cases (e.g. an extension reload while
  // the tab stays open), end up injected more than once into the same
  // document — never run two overlapping auto-run pipelines against the
  // same page.
  if (window.__sgsBridgeAutoRunLoaded) return
  window.__sgsBridgeAutoRunLoaded = true

  const AR_MESSAGE = {
    START: 'AR_START',
    STOP: 'AR_STOP',
    GET_STATE: 'AR_GET_STATE',
    MANUAL_CONTINUE: 'AR_MANUAL_CONTINUE',
    CHECK_ACTIVE: 'AR_CHECK_ACTIVE',
    PENDING_ADVANCE: 'AR_PENDING_ADVANCE',
    PAGE_PROGRESS: 'AR_PAGE_PROGRESS',
    PAGE_COMPLETE: 'AR_PAGE_COMPLETE',
    ADVANCE_CONFIRMED: 'AR_ADVANCE_CONFIRMED',
    MANUAL_PAUSE: 'AR_MANUAL_PAUSE',
    ABORT: 'AR_ABORT',
    STOPPED: 'AR_STOPPED',
    COMPLETE: 'AR_COMPLETE',
    KICKOFF: 'AR_KICKOFF',
    RESUME: 'AR_RESUME',
  }

  // The advance click's "best-effort settle, then verify in place ONLY IF
  // this instance is somehow still alive" wait, and the write's own
  // settle wait before reading back — never a confirmed "network request
  // finished" signal (no such signal has ever been confirmed live), same
  // honest caveat the previous popup-driven loop already carried.
  const POST_CLICK_SETTLE_MS = 800
  const POST_WRITE_SETTLE_MS = 250

  /** Kept only for the "still-loaded, teacher pressed ดำเนินการต่อ after
   * a manual pause" resume path — retrying the SAME page's advance
   * attempt never needs to rescan/rewrite that page's cells again. Reset
   * is unnecessary: this whole module is destroyed the moment the page
   * actually navigates, which is the only time it would ever be stale. */
  let lastPageContext = null
  let processing = false

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message)
    } catch {
      // The background service worker being briefly asleep, or the
      // extension having been reloaded/uninstalled mid-run, is never
      // itself treated as a DOM safety failure — callers that need a
      // reply just see `null` and stop this page's pipeline quietly.
      return null
    }
  }

  let libsPromise = null
  async function loadLibs() {
    if (!libsPromise) {
      libsPromise = Promise.all([
        import(chrome.runtime.getURL('src/content-diagnostic.js')),
        import(chrome.runtime.getURL('src/lib/auto-run.js')),
        import(chrome.runtime.getURL('src/lib/pagination-control.js')),
        import(chrome.runtime.getURL('src/lib/whole-column-write.js')),
        import(chrome.runtime.getURL('src/lib/subject-classroom-match.js')),
        import(chrome.runtime.getURL('src/lib/mapping.js')),
        import(chrome.runtime.getURL('src/lib/sgs-table-extraction.js')),
        import(chrome.runtime.getURL('src/lib/roster.js')),
      ]).then(([diagnostic, autoRun, pagination, wholeColumn, subjectClassroom, mapping, tableExtraction, roster]) => ({
        diagnostic,
        autoRun,
        pagination,
        wholeColumn,
        subjectClassroom,
        mapping,
        tableExtraction,
        roster,
      }))
    }
    return libsPromise
  }

  /**
   * The in-page equivalent of popup.js's old scanCurrentSgsPageForColumn —
   * same steps, but every DOM read is a direct function call (this file
   * already runs inside the SGS page) rather than a
   * chrome.scripting.executeScript round trip.
   */
  function scanCurrentPage(libs, columnKey) {
    const facts = libs.diagnostic.collectAllTableRowFacts()
    const subjectFilterText = facts.subjectFilter?.selectedText ?? null
    const classroomFilterText = facts.classroomFilter?.selectedText ?? null

    const candidate = libs.tableExtraction.pickBestStudentGridCandidate(facts.tables)
    if (!candidate) {
      return {
        ok: false,
        reason: 'ไม่พบตารางคะแนนนักเรียนในหน้านี้ — ตรวจสอบว่าเปิดหน้ากรอกคะแนนของ SGS อยู่หรือไม่',
        facts,
        candidate: null,
        column: null,
        pagination: null,
        subjectFilterText,
        classroomFilterText,
      }
    }

    const pagination = libs.tableExtraction.detectPagination(facts.tables, candidate, facts.paginationHints)
    const column = libs.wholeColumn.locateColumnOnCurrentPage(candidate.writableScoreColumns, columnKey)
    if (!column) {
      return {
        ok: false,
        reason: 'ไม่พบคอลัมน์ที่เลือกไว้เป็นช่องกรอกได้จริงในหน้านี้ — ตรวจสอบว่าติ๊กเปิดช่องคะแนนนี้ใน SGS แล้วหรือยัง',
        facts,
        candidate,
        column: null,
        pagination,
        subjectFilterText,
        classroomFilterText,
      }
    }

    const readResult = libs.diagnostic.readColumnValues(candidate.tableIndex, candidate.run.startIndex, candidate.run.length, column.columnIndex)
    const existingScoresBySgsRowKey = {}
    if (readResult.found) {
      for (const [offsetText, value] of Object.entries(readResult.values)) {
        existingScoresBySgsRowKey[libs.tableExtraction.buildSgsRowKey(Number(offsetText))] = value
      }
    }

    return { ok: true, reason: null, facts, candidate, column, pagination, existingScoresBySgsRowKey, subjectFilterText, classroomFilterText }
  }

  function buildPlanFromScan(libs, runState, scan) {
    const winningTable = scan.facts.tables.find((t) => t.tableIndex === scan.candidate.tableIndex)
    const sgsCandidates = winningTable
      ? libs.tableExtraction.extractSgsStudentCandidates(winningTable, scan.candidate.run, scan.candidate.identifierColumns)
      : []
    const roster = libs.roster.buildFullRosterFromPayload(runState.payload)
    const krunameStudents = roster.map((r) => ({
      studentId: r.studentId,
      studentNumber: r.studentNumber,
      studentCode: r.studentCode,
      fullName: r.fullName,
      score: r.score,
    }))
    const mappingResults = libs.mapping.matchStudentsToSgs(krunameStudents, sgsCandidates)
    return libs.wholeColumn.computeWholeColumnPlan(krunameStudents, mappingResults, scan.existingScoresBySgsRowKey, runState.overwriteMode, scan.column.maxScore)
  }

  /**
   * item 5's full "before every page" gate: the grid must be found, the
   * live SGS subject/classroom must match what the KrunameClass payload
   * itself claims (never merely "unchanged since the last page" — a real
   * mismatch against the payload is checked explicitly here, not only a
   * drift check), the CONFIRMED run baseline (this run's own first
   * successful page) must still match, an explicitly expected page number
   * (set after a resume) must match, the column must still be a real
   * writableScoreColumn, and its header checkbox (if any) must still be
   * checked. The FIRST failing reason wins — never a batch.
   */
  function evaluatePageGate(libs, runState, scan, confirmedContext) {
    if (!scan.ok) {
      return { ok: false, reason: scan.reason }
    }

    const subjectClassroomMatch = libs.subjectClassroom.evaluateSubjectClassroomMatch({
      krunameSubjectName: runState.subject,
      krunameClassroomName: runState.classroom,
      sgsSubjectFilterText: scan.subjectFilterText,
      sgsClassroomFilterText: scan.classroomFilterText,
    })
    if (!subjectClassroomMatch.ok) {
      return {
        ok: false,
        reason: !subjectClassroomMatch.subject.ok
          ? 'รายวิชาบนหน้า SGS ไม่ตรงกับ Bridge Payload ที่โหลดไว้ — หยุดเพื่อความปลอดภัย'
          : 'ห้องเรียนบนหน้า SGS ไม่ตรงกับ Bridge Payload ที่โหลดไว้ — หยุดเพื่อความปลอดภัย',
      }
    }

    if (confirmedContext) {
      const drift = libs.wholeColumn.revalidateWholeColumnContext(confirmedContext, {
        subjectFilterText: scan.subjectFilterText,
        classroomFilterText: scan.classroomFilterText,
        columnKey: scan.column.key,
      })
      if (!drift.ok) return drift
    }

    if (runState.expectedNextPage !== null && runState.expectedNextPage !== undefined) {
      if (scan.pagination?.currentPage !== runState.expectedNextPage) {
        return {
          ok: false,
          reason: `หน้าปัจจุบัน (${scan.pagination?.currentPage ?? 'ไม่ทราบ'}) ไม่ตรงกับหน้าที่คาดไว้ (${runState.expectedNextPage})`,
        }
      }
    }

    return { ok: true, reason: null }
  }

  /**
   * item 3/4's per-page pipeline: scan -> validate (item 5) -> write ONE
   * cell at a time with an immediate read-back (item 5's "write, read
   * back and verify") -> report -> decide to advance or finish. Never
   * batches writes, never clicks Save/another column/a header checkbox.
   */
  async function processCurrentPage(libs, runState) {
    if (processing) return
    processing = true
    try {
      const scan = scanCurrentPage(libs, runState.targetColumn.key)
      const confirmedContext = runState.confirmedContext

      const gate = evaluatePageGate(libs, runState, scan, confirmedContext)

      const plan = scan.ok ? buildPlanFromScan(libs, runState, scan) : []
      const stop = libs.autoRun.evaluateAutoRunStopCondition({
        gridFound: scan.ok,
        contextRevalidation: gate,
        columnWritableNow: scan.ok ? scan.candidate.writableScoreColumns.some((c) => c.key === scan.column.key) : false,
        headerCheckboxOk: scan.ok ? !scan.column.headerCheckboxPresent || scan.column.headerCheckboxChecked === true : false,
        hasAmbiguousWriteCandidate: libs.autoRun.planHasAmbiguousWriteCandidate(plan),
      })

      if (stop.shouldStop) {
        await sendMessage({ type: AR_MESSAGE.ABORT, reason: stop.reason })
        return
      }

      const nextConfirmedContext = confirmedContext ?? {
        subjectFilterText: scan.subjectFilterText,
        classroomFilterText: scan.classroomFilterText,
        columnKey: scan.column.key,
      }

      await sendMessage({
        type: AR_MESSAGE.PAGE_PROGRESS,
        pageNumber: scan.pagination?.currentPage ?? null,
        totalPages: scan.pagination?.totalPages ?? null,
        runningSummary: runState.summary,
        confirmedContext: confirmedContext ? null : nextConfirmedContext,
      })

      // ---- write this page, ONE cell at a time (item 5: never a batch) ----
      const verifiedRows = []
      let pageThresholdExceeded = false
      let stoppedMidPage = false

      for (const baseRow of plan) {
        const stateCheck = await sendMessage({ type: AR_MESSAGE.GET_STATE })
        if (stateCheck?.state?.stopRequested) stoppedMidPage = true

        if (stoppedMidPage) {
          // item 6: finish the current atomic cell op (already done —
          // we're between rows here), never start another write.
          verifiedRows.push({ ...baseRow, writeOutcome: null })
          continue
        }

        if (baseRow.status !== 'READY') {
          verifiedRows.push({ ...baseRow, writeOutcome: null })
        } else {
          const writesByOffset = { [baseRow.sgsRowOffset]: baseRow.krunameScore }
          const writeResult = libs.diagnostic.fillSgsColumnValues(scan.candidate.tableIndex, scan.candidate.run.startIndex, scan.column.columnIndex, writesByOffset)
          await delay(POST_WRITE_SETTLE_MS)
          const readResult = libs.diagnostic.readSingleColumnCellValue(
            scan.candidate.tableIndex,
            scan.candidate.run.startIndex + baseRow.sgsRowOffset,
            scan.column.columnIndex,
          )
          const missing = writeResult.missingOffsets.includes(baseRow.sgsRowOffset)
          const actualValue = readResult.found ? readResult.value : null
          const outcome = !missing && actualValue === baseRow.krunameScore ? 'WRITTEN' : 'FAILED'
          verifiedRows.push({ ...baseRow, writeOutcome: outcome })

          const attemptedSoFar = verifiedRows.filter((r) => r.status === 'READY').length
          const pageSoFarSummary = libs.autoRun.summarizeAutoRunPageResult(verifiedRows)
          if (libs.autoRun.pageFailureExceedsThreshold(pageSoFarSummary, attemptedSoFar)) pageThresholdExceeded = true
        }

        await sendMessage({
          type: AR_MESSAGE.PAGE_PROGRESS,
          pageNumber: scan.pagination?.currentPage ?? null,
          totalPages: scan.pagination?.totalPages ?? null,
          runningSummary: libs.autoRun.mergeAutoRunSummaries(runState.summary, libs.autoRun.summarizeAutoRunPageResult(verifiedRows)),
        })

        if (pageThresholdExceeded) break
      }

      const pageSummary = libs.autoRun.summarizeAutoRunPageResult(verifiedRows)
      const failedStudents = libs.wholeColumn.collectFailedStudents(verifiedRows)
      await sendMessage({
        type: AR_MESSAGE.PAGE_COMPLETE,
        pageNumber: scan.pagination?.currentPage ?? null,
        pageSummary,
        failedStudents,
        studentResults: verifiedRows,
      })

      if (pageThresholdExceeded) {
        await sendMessage({
          type: AR_MESSAGE.ABORT,
          reason: 'อัตราการเขียนคะแนนล้มเหลวในหน้านี้สูงเกินเกณฑ์ที่ปลอดภัย — ตรวจสอบหน้า SGS ด้วยตนเองก่อนดำเนินการต่อ',
        })
        return
      }

      if (stoppedMidPage) {
        await sendMessage({ type: AR_MESSAGE.STOPPED })
        return
      }

      if (!libs.pagination.shouldAttemptPageAdvance(scan.pagination)) {
        await sendMessage({ type: AR_MESSAGE.COMPLETE })
        return
      }

      lastPageContext = {
        candidate: scan.candidate,
        column: scan.column,
        confirmedContext: nextConfirmedContext,
        pagination: scan.pagination,
        targetColumnKey: runState.targetColumn.key,
      }
      await attemptAdvance(libs, lastPageContext)
    } finally {
      processing = false
    }
  }

  /**
   * item 4's click -> allow-postback -> verify-on-fresh-load sequence
   * (see this file's own header). Never clicks anything below
   * 'high'/'medium' confidence (pagination-control.js's own rule) — a
   * low-confidence/absent finding falls back to the SAME manual
   * "ดำเนินการต่อ" prompt this codebase has always used, never a guessed
   * selector.
   */
  async function attemptAdvance(libs, pageContext) {
    const { candidate, column, confirmedContext, pagination } = pageContext
    const expectedNextPage = pagination.currentPage + 1

    const inspection = libs.diagnostic.inspectPaginationControls()
    const nextControlResult = inspection.found
      ? libs.pagination.findSgsNextPageControl(inspection.candidates)
      : { control: null, confidence: 'none', reason: 'pagination cluster (the "N ของ M" text) not found on this page' }

    if (!nextControlResult.control || !libs.pagination.isConfidentEnoughToAutoClick(nextControlResult.confidence)) {
      await sendMessage({
        type: AR_MESSAGE.MANUAL_PAUSE,
        reason: 'ไม่พบปุ่ม/ลิงก์เปลี่ยนหน้าที่ยืนยันได้อย่างปลอดภัยบนหน้านี้',
        expectedNextPage,
      })
      return
    }

    const beforeFingerprint = libs.diagnostic.readGridFingerprint(candidate.tableIndex, candidate.run.startIndex, candidate.run.length)
    const pendingAdvance = { expectedNextPage, beforeFingerprint, confirmedContext, targetColumnKey: column.key }

    // item 4/5: persisted BEFORE navigating — the click below may trigger
    // a full ASP.NET postback that destroys this script instance.
    await sendMessage({ type: AR_MESSAGE.PENDING_ADVANCE, pendingAdvance })

    try {
      // A plain, ordinary click — the default browser action is never
      // suppressed first, so the control's own wiring (a native
      // __doPostBack, an onclick, a real form submit) fires exactly as it
      // would for a genuine teacher click.
      libs.diagnostic.clickPaginationControl(nextControlResult.control)
    } catch {
      // A real full-page postback can destroy this call's own execution
      // context before it returns — never itself a failure.
    }

    // Bonus path only: if this instance is SOMEHOW still alive (the
    // postback turned out to be a non-destructive update rather than a
    // full navigation), verify right here. If the instance was destroyed,
    // none of this ever runs — the FRESH instance on the reloaded page
    // performs the exact same verification via its own top-level
    // AR_CHECK_ACTIVE -> pendingAdvance check instead.
    await delay(POST_CLICK_SETTLE_MS)
    const stateResponse = await sendMessage({ type: AR_MESSAGE.GET_STATE })
    if (stateResponse?.state?.pendingAdvance) {
      await verifyPendingAdvance(libs, stateResponse.state, stateResponse.state.pendingAdvance)
    }
  }

  /**
   * The post-click verification itself — never trusts the click alone.
   * Runs from a FRESH scan, checked against exactly what
   * pagination-control.js's verifyPageAdvance requires: the expected page
   * number, a changed grid fingerprint, the column still found, and the
   * subject/classroom unchanged from this run's own confirmed baseline. A
   * CONFIRMED context mismatch aborts the whole run; anything else that
   * merely can't be confirmed falls back to the manual continue prompt.
   */
  async function verifyPendingAdvance(libs, runState, pendingAdvance) {
    const scan = scanCurrentPage(libs, pendingAdvance.targetColumnKey)
    const actualPage = scan.pagination?.currentPage ?? null
    const afterFingerprint = scan.ok
      ? libs.diagnostic.readGridFingerprint(scan.candidate.tableIndex, scan.candidate.run.startIndex, scan.candidate.run.length)
      : null
    const subjectOk = pendingAdvance.confirmedContext ? scan.ok && scan.subjectFilterText === pendingAdvance.confirmedContext.subjectFilterText : true
    const classroomOk = pendingAdvance.confirmedContext
      ? scan.ok && scan.classroomFilterText === pendingAdvance.confirmedContext.classroomFilterText
      : true

    const result = libs.pagination.verifyPageAdvance({
      expectedNextPage: pendingAdvance.expectedNextPage,
      actualPage,
      beforeFingerprint: pendingAdvance.beforeFingerprint,
      afterFingerprint,
      columnStillFound: scan.ok,
      subjectOk,
      classroomOk,
    })

    if (result.ok) {
      await sendMessage({ type: AR_MESSAGE.ADVANCE_CONFIRMED })
      await processCurrentPage(libs, { ...runState, pendingAdvance: null, expectedNextPage: pendingAdvance.expectedNextPage })
      return
    }
    if (result.kind === 'context_mismatch') {
      await sendMessage({ type: AR_MESSAGE.ABORT, reason: result.reason })
      return
    }
    await sendMessage({
      type: AR_MESSAGE.MANUAL_PAUSE,
      reason: 'ไม่สามารถเปลี่ยนหน้าอัตโนมัติได้ กรุณาเปิดหน้าถัดไปแล้วกดดำเนินการต่อ',
      expectedNextPage: pendingAdvance.expectedNextPage,
    })
  }

  /** item 4: "content script starts automatically" on every fresh SGS
   * page load — asks background whether an approved run is active for
   * THIS tab and, if so, either verifies a click it made just before this
   * page loaded, or begins processing this page fresh. Does nothing at
   * all when no run is active — this file is otherwise fully passive. */
  async function main() {
    const response = await sendMessage({ type: AR_MESSAGE.CHECK_ACTIVE })
    if (!response) return

    const libs = await loadLibs()

    if (response.pendingAdvance) {
      await verifyPendingAdvance(libs, response.state, response.pendingAdvance)
      return
    }
    if (response.shouldProcess) {
      await processCurrentPage(libs, response.state)
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === AR_MESSAGE.KICKOFF) {
      sendResponse({ ok: true })
      void loadLibs().then(async (libs) => {
        const stateResponse = await sendMessage({ type: AR_MESSAGE.GET_STATE })
        if (stateResponse?.state) await processCurrentPage(libs, stateResponse.state)
      })
      return true
    }
    if (message?.type === AR_MESSAGE.RESUME) {
      sendResponse({ ok: true })
      void loadLibs().then(async (libs) => {
        const stateResponse = await sendMessage({ type: AR_MESSAGE.GET_STATE })
        const runState = stateResponse?.state
        if (!runState) return
        if (lastPageContext) {
          await attemptAdvance(libs, lastPageContext)
        } else {
          await processCurrentPage(libs, runState)
        }
      })
      return true
    }
    return false
  })

  void main()
})()
