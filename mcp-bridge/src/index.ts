#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { ConfigError, loadConfig } from './config.js'
import { EdgeFunctionClient } from './edge-function-client.js'
import { logError, logInfo } from './logger.js'
import { createServer } from './server.js'
import { READ_TOOL_NAMES } from './tool-schemas.js'
import { TeacherAuthError, TeacherSession } from './teacher-session.js'

/**
 * Process entry point. Fails fast (clear stderr message, exit code 1)
 * on any startup problem — a missing env var or a rejected teacher
 * credential — rather than starting a stdio server that would only
 * fail on the first tool call. This is deliberate: Hermes (or any MCP
 * client) sees a stdio server exit immediately as a clean "this server
 * didn't start" signal, instead of a connection that looks healthy
 * until the first request.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env)

  if (config.serviceRoleKeyPresentButIgnored) {
    logInfo(
      'SUPABASE_SERVICE_ROLE_KEY is set in this environment but is NEVER read by this bridge — ' +
        'remove it, it has no effect here and should not be present on a machine running Hermes.',
    )
  }

  const session = new TeacherSession(config)
  // Sign in / exchange the refresh token once up front so a bad
  // credential is reported immediately, before the MCP transport ever
  // connects.
  await session.ensureValidSession()

  const client = new EdgeFunctionClient(session, config.supabaseUrl, config.supabaseAnonKey)
  const { server } = createServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  logInfo(`connected over stdio — registered ${READ_TOOL_NAMES.length} read tools: ${READ_TOOL_NAMES.join(', ')}`)
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    logError('Configuration error', err)
  } else if (err instanceof TeacherAuthError) {
    logError('Teacher authentication failed at startup', err)
  } else {
    logError('Fatal error starting teacher-agent-mcp-bridge', err)
  }
  process.exit(1)
})
