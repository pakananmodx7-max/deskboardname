// deno-lint-ignore-file no-explicit-any
/**
 * A deliberately tiny, dependency-free JSON-Schema-*shaped* validator —
 * just enough to describe and check every Teacher Agent Tool's input
 * (strings, uuids, dates, numbers, booleans, enums, arrays of the above,
 * nested objects) without pulling in a validation library into an Edge
 * Function's bundle. The shape is a subset of real JSON Schema on
 * purpose: `toJsonSchema()` below returns something that already looks
 * like a standard JSON Schema `properties`/`required` object, so it can
 * be handed to an OpenAI/Hermes-style "tools" array later with no
 * translation layer — see registry.ts's own doc comment.
 */

export type ToolPropertyType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'

export interface ToolProperty {
  type: ToolPropertyType
  description?: string
  /** Extra semantic hint for string types — checked, not just documented. */
  format?: 'uuid' | 'date'
  enum?: readonly string[]
  /** Required when type === 'array'. */
  items?: ToolProperty
  /** Required when type === 'object'. */
  properties?: Record<string, ToolProperty>
  required?: readonly string[]
  minimum?: number
}

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, ToolProperty>
  required?: readonly string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function validateProperty(path: string, prop: ToolProperty, value: unknown, errors: string[]): void {
  if (value === undefined || value === null) return // presence is `required`'s job

  switch (prop.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: ต้องเป็นข้อความ`)
        return
      }
      if (prop.format === 'uuid' && !UUID_RE.test(value)) {
        errors.push(`${path}: รูปแบบไม่ถูกต้อง (ต้องเป็น UUID)`)
      }
      if (prop.format === 'date' && !DATE_RE.test(value)) {
        errors.push(`${path}: รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)`)
      }
      if (prop.enum && !prop.enum.includes(value)) {
        errors.push(`${path}: ต้องเป็นหนึ่งใน [${prop.enum.join(', ')}]`)
      }
      break
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: ต้องเป็นตัวเลข`)
        return
      }
      if (prop.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${path}: ต้องเป็นจำนวนเต็ม`)
      }
      if (prop.minimum !== undefined && value < prop.minimum) {
        errors.push(`${path}: ต้องมีค่าอย่างน้อย ${prop.minimum}`)
      }
      break
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: ต้องเป็น true/false`)
      break
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: ต้องเป็นรายการ (array)`)
        return
      }
      if (prop.items) {
        value.forEach((item, i) => validateProperty(`${path}[${i}]`, prop.items as ToolProperty, item, errors))
      }
      break
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: ต้องเป็นอ็อบเจ็กต์`)
        return
      }
      validateArgs({ type: 'object', properties: prop.properties ?? {}, required: prop.required }, value, path, errors)
      break
    }
  }
}

/**
 * Validates `args` against `schema`, collecting every problem found
 * (never throws) — the caller (index.ts) decides how to respond. Unknown
 * top-level keys are rejected too: an agent tool's surface is meant to be
 * exactly what it declares, not "whatever extra fields happen to be
 * ignored" (avoids a caller silently believing an extra field did
 * something).
 */
export function validateArgs(
  schema: ToolInputSchema,
  args: unknown,
  path = 'args',
  errors: string[] = [],
): ValidationResult {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    errors.push(`${path}: ต้องเป็นอ็อบเจ็กต์ (object)`)
    return { ok: false, errors }
  }
  const record = args as Record<string, unknown>

  for (const key of schema.required ?? []) {
    if (record[key] === undefined || record[key] === null) {
      errors.push(`${path}.${key}: จำเป็นต้องระบุ`)
    }
  }

  for (const key of Object.keys(record)) {
    const propSchema = schema.properties[key]
    if (!propSchema) {
      errors.push(`${path}.${key}: ไม่รู้จักฟิลด์นี้`)
      continue
    }
    validateProperty(`${path}.${key}`, propSchema, record[key], errors)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Converts this tool's own input schema into a plain JSON Schema object
 * — already the shape an OpenAI/Hermes-style function-calling `tools`
 * entry expects for `parameters`. Exists so a later "connect Hermes"
 * phase can build its tool definitions straight from this registry
 * (`{ name, description, parameters: toJsonSchema(schema) }`) without
 * hand-translating or duplicating any business logic.
 */
export function toJsonSchema(schema: ToolInputSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema))
}
