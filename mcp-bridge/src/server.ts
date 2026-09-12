import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { EdgeFunctionClient } from './edge-function-client.js'
import { logError } from './logger.js'
import { toolSchemas } from './tool-schemas.js'

const SERVER_NAME = 'teacher-agent-tools-bridge'
const SERVER_VERSION = '0.1.0'

export interface CreatedServer {
  server: McpServer
  /** Exposed only so tests can call a registered tool's handler
   * directly without spinning up a real transport — index.ts never
   * touches this, it only connects `server`. */
  registeredTools: Record<string, RegisteredTool>
}

/**
 * Builds the MCP server and registers exactly the 5 read tools from
 * tool-schemas.ts — nothing else. Each tool's handler does nothing but
 * call the Edge Function through `client` and translate its response
 * into an MCP CallToolResult; no business logic (ownership checks,
 * argument validation beyond the zod shape Hermes itself will already
 * enforce before sending, response shaping) lives here.
 */
export function createServer(client: EdgeFunctionClient): CreatedServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const registeredTools: Record<string, RegisteredTool> = {}

  for (const [name, schema] of Object.entries(toolSchemas)) {
    registeredTools[name] = server.registerTool(
      name,
      { description: schema.description, inputSchema: schema.input },
      async (args: Record<string, unknown>) => {
        try {
          const result = await client.callTool(name, args)

          if (!result.ok) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `${result.error.code}: ${result.error.message}`,
                },
              ],
            }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
            structuredContent: (result.data ?? {}) as Record<string, unknown>,
          }
        } catch (err) {
          // Backstop only — every expected failure (auth, network,
          // malformed response) is already caught inside
          // EdgeFunctionClient.callTool and returned as a normal
          // `{ ok: false }` result above, never thrown. Reaching this
          // branch means something unexpected happened; it is logged
          // to stderr (never to the MCP response, which could reach
          // Hermes/Telegram) and reported to the caller generically.
          logError(`Unhandled error while running tool "${name}"`, err)
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'internal_error: The bridge hit an unexpected error. See the bridge process stderr for details.',
              },
            ],
          }
        }
      },
    )
  }

  return { server, registeredTools }
}
