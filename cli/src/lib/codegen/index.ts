/**
 * Codegen orchestrator.
 * Called after `supa project pull` writes `supabase/types/database.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDatabaseTypes } from "./parse-database-types.js";
import { generateZodSchemas } from "./zod-schema.js";
import { generateTanStackDb } from "./tanstack-db.js";
import type { CodegenConfig } from "@supabase-dx/config";

export interface CodegenFile {
  relativePath: string;
  content: string;
}

export interface CodegenResult {
  files: CodegenFile[];
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

  const files: CodegenFile[] = [];
  const hasZod = config.validation === "zod";
  const hasTanStack = config.plugins?.includes("tanstack") ?? false;

  if (hasZod) {
    files.push({
      relativePath: "supabase/types/schema.ts",
      content: generateZodSchemas(parsed),
    });
  }

  if (hasTanStack) {
    files.push({
      relativePath: "supabase/lib/db.ts",
      content: generateTanStackDb(parsed, { hasZodSchemas: hasZod }),
    });
  }

  return { files };
}
