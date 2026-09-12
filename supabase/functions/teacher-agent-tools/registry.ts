// deno-lint-ignore-file no-explicit-any
/**
 * The Teacher Agent Tool Layer's registry — the single list of every
 * tool an external agent (Hermes, later) may call through
 * `POST /functions/v1/teacher-agent-tools`. Deliberately a flat,
 * hand-curated array, not anything dynamic/reflective: adding a tool
 * here is a deliberate code change and code review, never something a
 * request body can influence.
 *
 * Nothing here is Hermes/OpenAI-specific. `AgentTool.inputSchema` (see
 * types.ts and tool-schema.ts) is already real-JSON-Schema-shaped, so a
 * later integration phase can build an OpenAI/Hermes-style function-
 * calling tool list straight from this array:
 *
 *   import { toolRegistry } from './registry.ts'
 *   import { toJsonSchema } from '../_shared/tool-schema.ts'
 *   const hermesTools = toolRegistry.map((t) => ({
 *     name: t.name,
 *     description: t.description,
 *     parameters: toJsonSchema(t.inputSchema),
 *   }))
 *
 * with ZERO duplication of any handler/business logic — the handlers
 * themselves never change when a new caller (Hermes) is wired up later.
 *
 * ONLY read tools and the three explicitly-approved safe write tools
 * exist here. There is intentionally no delete_* tool, no arbitrary
 * table/SQL access, and no Storage access of any kind — see this
 * repository's Phase 1 report for the full list of what was
 * deliberately left out and why.
 */
import { readTools } from './tools/read-tools.ts'
import { writeTools } from './tools/write-tools.ts'
import type { AgentTool } from './types.ts'

export const toolRegistry: AgentTool<any>[] = [...readTools, ...writeTools]

const toolsByName = new Map(toolRegistry.map((tool) => [tool.name, tool]))

export function findTool(name: string): AgentTool<any> | undefined {
  return toolsByName.get(name)
}
