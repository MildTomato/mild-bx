import type { OpenAPIProperty } from "./types.js"

const VALID_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function sanitizeIdentifier(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_")
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`
  }
  sanitized = sanitized.replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "_"

  if (!VALID_IDENTIFIER_RE.test(sanitized)) {
    throw new Error(
      `Cannot safely map name "${name}" to a valid identifier. Names must contain only letters, digits, and underscores.`
    )
  }

  return sanitized
}

export function safeFileSegment(name: string): string {
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0") ||
    name.startsWith(".")
  ) {
    throw new Error(
      `Unsafe file segment: "${name}". Names must not contain path separators, traversal sequences, or start with a dot.`
    )
  }

  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
  if (!sanitized) {
    throw new Error(`Cannot safely map name "${name}" to a file path segment.`)
  }

  return sanitized
}

export function propAccess(obj: string, name: string): string {
  if (VALID_IDENTIFIER_RE.test(name)) {
    return `${obj}.${name}`
  }
  return `${obj}[${JSON.stringify(name)}]`
}

export function validateDefinitionNames(
  definitions: Record<string, { properties?: Record<string, unknown> }>
): void {
  for (const [tableName, def] of Object.entries(definitions)) {
    if (tableName.startsWith("_")) continue
    sanitizeIdentifier(tableName)
    safeFileSegment(tableName)

    if (def.properties) {
      for (const colName of Object.keys(def.properties)) {
        if (colName.includes("\0") || colName.includes("\\")) {
          throw new Error(
            `Unsafe column name "${colName}" in table "${tableName}". Column names must not contain null bytes or backslashes.`
          )
        }
      }
    }
  }
}

export function openApiTypeToZod(prop: OpenAPIProperty, isRequired: boolean): string {
  let zodType: string

  switch (prop.type) {
    case "string":
      if (prop.format === "uuid") {
        zodType = "z.string().uuid()"
      } else if (prop.format === "date-time" || prop.format === "timestamp with time zone") {
        zodType = "z.string()"
      } else if (prop.enum && prop.enum.length > 0) {
        const enumValues = prop.enum.map((e) => `'${e.replace(/'/g, "\\'")}'`).join(", ")
        zodType = `z.enum([${enumValues}])`
      } else {
        zodType = "z.string()"
      }
      break
    case "integer":
      zodType = "z.number().int()"
      break
    case "number":
      zodType = "z.number()"
      break
    case "boolean":
      zodType = "z.boolean()"
      break
    case "array":
      if (prop.items) {
        const itemType = openApiTypeToZod(prop.items as OpenAPIProperty, true)
        zodType = `z.array(${itemType})`
      } else {
        zodType = "z.array(z.unknown())"
      }
      break
    case "object":
      zodType = "z.record(z.unknown())"
      break
    default:
      zodType = "z.unknown()"
  }

  if (!isRequired) {
    zodType += ".nullable()"
  }

  return zodType
}

export function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("")
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export function toLabel(fieldName: string): string {
  return fieldName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function toSingular(tableName: string): string {
  if (tableName.endsWith("ies")) {
    return tableName.slice(0, -3) + "y"
  }
  if (tableName.endsWith("ses") || tableName.endsWith("xes") || tableName.endsWith("zes")) {
    return tableName.slice(0, -2)
  }
  if (tableName.endsWith("s") && !tableName.endsWith("ss")) {
    return tableName.slice(0, -1)
  }
  return tableName
}

export function findPrimaryKeys(properties: Record<string, OpenAPIProperty>): string[] {
  const primaryKeys: string[] = []

  for (const [name, prop] of Object.entries(properties)) {
    if (prop.description?.toLowerCase().includes("primary key")) {
      primaryKeys.push(name)
    }
  }

  if (primaryKeys.length === 0 && properties["id"]) {
    primaryKeys.push("id")
  }

  return primaryKeys
}
