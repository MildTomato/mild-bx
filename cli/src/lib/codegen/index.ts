/**
 * Codegen orchestrator.
 * Called after `supa project pull` writes `supabase/types/database.ts`.
 *
 * Parses the generated database.ts, converts to OpenAPI-style definitions,
 * then runs the same generators used by the Supabase UI library registry.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDatabaseTypes } from "./parse-database-types.js";
import { generateDbContent, generateSchemasContent } from "./generators/index.js";
import type { OpenAPIDefinition, OpenAPIProperty } from "./types.js";
import type { CodegenConfig } from "@supabase-dx/config";
import type { ParsedDatabase, ParsedField } from "./parse-database-types.js";

export interface CodegenFile {
  relativePath: string;
  content: string;
}

export interface CodegenResult {
  files: CodegenFile[];
}

/**
 * Convert a parsed TypeScript type string to an OpenAPI property.
 * This bridges our database.ts parser output to the OpenAPI format
 * expected by the generators (cloned from supabase/supabase ui-library).
 */
function tsTypeToOpenApiProperty(field: ParsedField): OpenAPIProperty {
  const base = field.baseType;

  if (base === "number") return { type: "number" };
  if (base === "boolean") return { type: "boolean" };
  if (base === "string") return { type: "string" };
  if (base === "Json") return { type: "object" };
  if (base === "unknown") return { type: "object" };
  if (base.endsWith("[]")) {
    const inner = base.slice(0, -2);
    return { type: "array", items: { type: inner === "number" ? "number" : "string" } };
  }

  // Default
  return { type: "string" };
}

/**
 * Convert our ParsedDatabase (from database.ts) to OpenAPI definitions
 * so the generators produce identical output to the UI library registry.
 */
function toOpenApiDefinitions(parsed: ParsedDatabase): Record<string, OpenAPIDefinition> {
  const definitions: Record<string, OpenAPIDefinition> = {};

  for (const schema of parsed.schemas) {
    for (const table of schema.tables) {
      const properties: Record<string, OpenAPIProperty> = {};
      const required: string[] = [];

      for (const field of table.row) {
        properties[field.name] = tsTypeToOpenApiProperty(field);

        // If the field is NOT optional in Insert, it's required
        const insertField = table.insert.find((f) => f.name === field.name);
        if (insertField && !insertField.optional) {
          required.push(field.name);
        }
      }

      // Mark primary key candidates via description (matches findPrimaryKeys in utils)
      // Primary keys are always required (non-nullable).
      const idProp = properties["id"];
      if (idProp) {
        idProp.description = "Note:\nThis is a Primary Key.<pk/>";
        if (!required.includes("id")) required.push("id");
      } else if (table.row.length > 0) {
        const firstField = table.row[0].name;
        if (properties[firstField]) {
          properties[firstField].description = "Note:\nThis is a Primary Key.<pk/>";
          if (!required.includes(firstField)) required.push(firstField);
        }
      }

      definitions[table.name] = { type: "object", properties, required };
    }
  }

  return definitions;
}

/**
 * Run codegen based on `config.codegen`.
 * Reads the generated `database.ts` and produces additional files.
 * Returns files to write — the caller handles writing and dry-run logic.
 */
export function runCodegen(cwd: string, config: CodegenConfig): CodegenResult {
  const typesPath = join(cwd, "supabase", "types", "database.ts");

  let typesSource: string;
  try {
    typesSource = readFileSync(typesPath, "utf-8");
  } catch {
    return { files: [] };
  }

  const parsed = parseDatabaseTypes(typesSource);
  if (parsed.schemas.length === 0) return { files: [] };

  const definitions = toOpenApiDefinitions(parsed);
  const files: CodegenFile[] = [];
  const hasZod = config.validation === "zod";
  const hasTanStack = config.plugins?.includes("tanstack") ?? false;

  if (hasZod) {
    files.push({
      relativePath: "supabase/types/schema.ts",
      content: generateSchemasContent(parsed),
    });
  }

  if (hasTanStack) {
    files.push({
      relativePath: "supabase/lib/db.ts",
      content: generateDbContent(definitions, {
        clientPath: config.tanstack?.client_path,
        clientFunctionName: config.tanstack?.client_function_name,
      }),
    });
  }

  return { files };
}
