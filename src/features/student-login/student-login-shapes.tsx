/**
 * Two soft, static blue shapes behind the student login (upper-left curve,
 * right-edge oval). CSS only (.kc-student-shape-* in index.css): no
 * animation, aria-hidden, pointer-events none, clipped to the page so they
 * never cause horizontal scrolling, and drawn behind the form.
 */
export function StudentLoginShapes() {
  return (
    <div aria-hidden="true" data-testid="student-login-shapes" className="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden">
      <div className="kc-student-shape-top" />
      <div className="kc-student-shape-right" />
    </div>
  )
}
