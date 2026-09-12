# teacher-agent-mcp-bridge

A **local** MCP (Model Context Protocol) stdio server that exposes the
already-deployed production `teacher-agent-tools` Supabase Edge Function's
**READ tools only** to an MCP client such as Hermes.

It runs entirely on the teacher's own machine (this is what makes it a
"bridge," not a hosted service), talks to Supabase Auth to sign in as a
real teacher, and calls the Edge Function over plain HTTPS. It never
touches the database directly, never holds a `service_role` key, and
never adds or changes any business rule — every actual answer (which
classrooms this teacher owns, attendance rates, missing submissions,
etc.) comes from the Edge Function and the Row Level Security policies
behind it, exactly as it does for the real web app.

## What this is not

- Not a new Supabase Edge Function, and it does not modify the deployed
  one.
- Not a database or RLS change.
- Not a write-capable tool layer. Only 5 read tools are registered:
  `list_classrooms`, `list_assignments`, `get_missing_submissions`,
  `get_classroom_summary`, `get_student_summary`. The 3 write tools that
  already exist on the Edge Function (`create_assignment`,
  `copy_assignment_to_classrooms`, `mark_attendance_bulk`) are
  deliberately not exposed here yet.

## How authentication works

The bridge signs in to Supabase Auth as one specific teacher account —
the same identity/authorization boundary the web app itself uses (Row
Level Security scoped to `auth.uid()`), never a `service_role` key. Pick
one of two credential modes:

- **Email + password** (`SUPABASE_TEACHER_EMAIL` / `SUPABASE_TEACHER_PASSWORD`)
  — simplest to set up; the bridge calls the same `signInWithPassword`
  the login page uses.
- **Refresh token** (`SUPABASE_TEACHER_REFRESH_TOKEN`) — avoids storing a
  plaintext password in the Hermes config. Obtain one once (e.g. by
  signing in through the browser app and reading `refresh_token` from
  the resulting Supabase session, or via `supabase.auth.signInWithPassword`
  in a one-off script) and store only that.

Whichever mode is used, the bridge:

- Refreshes the session automatically before it expires, and once more
  (forcing a fresh sign-in/refresh) if the Edge Function itself ever
  returns 401 — never more than that one retry, so a genuinely dead
  credential fails clearly instead of looping.
- Fails **fast** at startup with a clear, non-zero-exit error if the
  credential is missing or rejected — a broken config is visible
  immediately in Hermes, not just on first tool call.
- Never prints, logs, or returns the access token, refresh token, or
  password anywhere — not in error messages shown to the MCP client, not
  in the bridge's own stderr diagnostics. All stderr output is scrubbed
  of anything JWT-shaped as defense in depth on top of the fact that no
  code path ever passes a credential into a log call.
- If a `SUPABASE_SERVICE_ROLE_KEY` variable happens to be present in the
  environment (e.g. copy-pasted from the Edge Function's own `.env`),
  the bridge only checks that it's *present* to print a one-line warning
  that it's unused — its value is never read into any variable.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | The project URL, e.g. `https://hmlcebcbfyhbmicdbnkr.supabase.co`. |
| `SUPABASE_ANON_KEY` | yes | The project's **public** anon/publishable key — the same one already shipped in the web app's browser bundle. Not a secret, but still project-specific. |
| `SUPABASE_TEACHER_EMAIL` + `SUPABASE_TEACHER_PASSWORD` | one of these two credential pairs | The teacher account the bridge signs in as. |
| `SUPABASE_TEACHER_REFRESH_TOKEN` | | Alternative to the email/password pair — see above. |

Never set `SUPABASE_SERVICE_ROLE_KEY` here.

## Building and running locally (Windows or otherwise)

```bash
cd mcp-bridge
npm install
npm run build
```

This produces `dist/index.js`, a plain Node ESM script. Run it directly
with `node`:

```powershell
node C:\path\to\deskboardname\mcp-bridge\dist\index.js
```

Using `node <script>.js` explicitly (rather than relying on the file's
shebang or an npm-installed `.cmd` shim) is the most portable way to run
it from Hermes on Windows — no shell, no PATH assumptions, just Node.

## Hermes `config.yaml` — `mcp_servers` block

Hermes spawns stdio MCP servers as `command` + `args`, with `env` for
the process's environment variables — the same shape most MCP-compatible
clients use. Add an entry like this:

```yaml
mcp_servers:
  teacher-agent-tools:
    command: node
    args:
      - "C:\\path\\to\\deskboardname\\mcp-bridge\\dist\\index.js"
    env:
      SUPABASE_URL: "https://hmlcebcbfyhbmicdbnkr.supabase.co"
      SUPABASE_ANON_KEY: "<the project's public anon/publishable key>"
      SUPABASE_TEACHER_EMAIL: "teacher@example.com"
      SUPABASE_TEACHER_PASSWORD: "<the teacher's password>"
```

or, using a refresh token instead of a password:

```yaml
mcp_servers:
  teacher-agent-tools:
    command: node
    args:
      - "C:\\path\\to\\deskboardname\\mcp-bridge\\dist\\index.js"
    env:
      SUPABASE_URL: "https://hmlcebcbfyhbmicdbnkr.supabase.co"
      SUPABASE_ANON_KEY: "<the project's public anon/publishable key>"
      SUPABASE_TEACHER_REFRESH_TOKEN: "<a refresh token obtained once via login>"
```

**This shape (`command`/`args`/`env` under `mcp_servers`) is the
standard MCP stdio-server configuration convention used by most
MCP-compatible clients (e.g. Claude Desktop's equivalent `mcpServers`
block) and matches the terminology in the task this bridge was built
for. It has not been verified against Hermes v0.21.2's own schema from
inside this environment — this sandbox has no network access to Hermes
or its documentation. Please confirm the exact key names against
Hermes's own docs/config validation before relying on this verbatim.**

Whatever file holds this block sits on the teacher's own Windows
machine and contains a real credential (a password or refresh token) —
treat it like any other secret file: restrict its file permissions and
never commit it to a repository.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc -p tsconfig.json -> dist/
```

This package is intentionally separate from the main `deskboardname`
Vite app — its own `package.json`, `tsconfig.json`, and
`vitest.config.ts`, excluded from the root project's own test run (see
the root `vitest.config.ts`'s `test.exclude`). It has its own
`node_modules`, installed independently.
