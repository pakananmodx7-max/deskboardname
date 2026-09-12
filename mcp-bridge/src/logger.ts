/**
 * The ONLY logging surface this bridge uses. An MCP stdio server MUST
 * treat stdout as reserved exclusively for the JSON-RPC protocol
 * stream — anything else written to stdout (a stray console.log, an
 * uncaught print) corrupts the connection Hermes is reading. Every log
 * line here goes to stderr instead, which MCP stdio clients treat as
 * plain diagnostic output.
 *
 * Every message is also scrubbed for anything JWT-shaped before being
 * written, as defense in depth on top of the fact that no code in this
 * bridge ever deliberately logs a bearer token, refresh token, or
 * password — see teacher-session.ts and edge-function-client.ts, which
 * never pass a credential value into any log call.
 */

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

export function scrub(text: string): string {
  return text.replace(JWT_PATTERN, '[redacted]')
}

function describeError(err: unknown): string {
  if (err instanceof Error) return scrub(err.message)
  return scrub(String(err))
}

export function logInfo(message: string): void {
  process.stderr.write(`[teacher-agent-mcp-bridge] ${scrub(message)}\n`)
}

export function logError(message: string, err?: unknown): void {
  const suffix = err === undefined ? '' : `: ${describeError(err)}`
  process.stderr.write(`[teacher-agent-mcp-bridge] ERROR: ${scrub(message)}${suffix}\n`)
}
