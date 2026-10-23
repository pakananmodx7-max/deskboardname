/**
 * Open edits that are not saved yet (e.g. attendance checked but not
 * "บันทึก"). The PWA update prompt refuses to reload while any exist:
 * the browser's own "leave page?" prompt (beforeunload) does not appear
 * on iPhone/iPad, so it cannot be relied on there.
 */

let open = 0

/** Marks unsaved work; call the returned function when it is saved or discarded. */
export function markUnsavedWork(): () => void {
  open += 1
  let released = false
  return () => {
    if (released) return
    released = true
    open -= 1
  }
}

export function hasUnsavedWork(): boolean {
  return open > 0
}
