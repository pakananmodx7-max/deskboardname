// deno-lint-ignore-file no-explicit-any
import type { AgentContext } from '../_shared/agent-context.ts'
import type { ToolInputSchema } from '../_shared/tool-schema.ts'

/**
 * One entry in the Teacher Agent Tool Layer's registry. This is the
 * single definition every tool has — `index.ts` looks tools up by
 * `name`, validates the caller's `args` against `inputSchema` (see
 * tool-schema.ts), then calls `handler`. Nothing about a tool's HTTP
 * shape, auth, or validation lives inside the tool itself — a handler
 * only ever receives an already-authenticated AgentContext and
 * already-shape-validated args, and returns plain, JSON-serializable
 * data (or throws one of agent-context.ts's typed errors).
 *
 * `inputSchema` is deliberately real-JSON-Schema-*shaped* (see
 * tool-schema.ts's own doc comment) so a later "connect Hermes" phase
 * can build an OpenAI/Hermes-style tools array as
 * `registry.map(t => ({ name: t.name, description: t.description,
 * parameters: toJsonSchema(t.inputSchema) }))` — reading this same
 * registry, never hand-duplicating it.
 */
export interface AgentTool<TArgs = any> {
  name: string
  description: string
  inputSchema: ToolInputSchema
  handler: (ctx: AgentContext, args: TArgs) => Promise<unknown>
}
