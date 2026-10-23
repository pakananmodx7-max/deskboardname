/**
 * Two soft, static blue shapes behind the login pages (upper-left curve,
 * right-edge oval). CSS only (.kc-login-shape-* in index.css): no
 * animation, aria-hidden, pointer-events none, clipped to the page so they
 * never cause horizontal scrolling, and drawn behind the form.
 */
export function LoginShapes() {
  return (
    <div aria-hidden="true" data-testid="login-shapes" className="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden">
      <div className="kc-login-shape-top" />
      <div className="kc-login-shape-right" />
    </div>
  )
}
