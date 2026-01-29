/**
 * Atlas schema diffing wrapper
 * Uses @ariga/atlas for declarative schema management
 * Uses PGlite as dev database (no Docker required)
 */

import { execSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  startDevDb,
  stopDevDb,
  isPGliteAvailable,
  execOnDevDb,
  getDevDbUrl,
} from "./pglite-dev.js";

// Supabase managed schemas to exclude from diffing
const EXCLUDED_SCHEMAS = [
  "auth",
  "storage",
  "realtime",
  "supabase_migrations",
  "supabase_functions",
  "pgsodium",
  "vault",
  "graphql",
  "graphql_public",
  "extensions",
  "_analytics",
  "_realtime",
  "net",
  "pgsodium_masks",
  "cron",
];

// Create require for ESM compatibility
const require = createRequire(import.meta.url);

/**
 * Sanitize connection strings to remove passwords from error messages
 */
function sanitizeConnectionString(str: string): string {
  // Replace password in postgresql:// URLs
  return str.replace(/(postgresql:\/\/[^:]+:)[^@]+(@)/gi, "$1***$2");
}

/**
 * Sanitize error message to remove any credentials
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeConnectionString(error.message);
  }
  return sanitizeConnectionString(String(error));
}

/**
 * Get the Atlas binary path from the @ariga/atlas package
 */
function getAtlasBinary(): string {
  // The @ariga/atlas package installs the binary directly in package root
  const packagePath = dirname(require.resolve("@ariga/atlas/package.json"));

  let binaryName = "atlas";
  if (process.platform === "win32") {
    binaryName = "atlas.exe";
  }

  // Atlas binary is directly in package root
  const binaryPath = join(packagePath, binaryName);

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Atlas binary not found at ${binaryPath}. Try reinstalling @ariga/atlas.`,
    );
  }

  return binaryPath;
}

/**
 * Build exclude flags for Atlas commands
 */
function buildExcludeFlags(): string[] {
  return EXCLUDED_SCHEMAS.flatMap((schema) => ["--exclude", `${schema}.*`]);
}

export interface SchemaFile {
  path: string; // Relative path from schema dir
  content: string; // File content
}

export interface SchemaDiff {
  files: SchemaFile[]; // Local schema files
  hasChanges: boolean;
}

/**
 * Priority order for schema files based on PostgreSQL dependencies
 * Lower number = higher priority (runs first)
 */
const FILE_PRIORITY: Record<string, number> = {
  extensions: 1,
  types: 2,
  enums: 2,
  domains: 2,
  tables: 3,
  table: 3,
  indexes: 4,
  index: 4,
  functions: 5,
  function: 5,
  triggers: 6,
  trigger: 6,
  rls: 7,
  policies: 7,
  policy: 7,
  grants: 8,
  permissions: 8,
};

/**
 * Get priority for a file based on its name or parent directory
 */
function getFilePriority(relativePath: string): number {
  const parts = relativePath.toLowerCase().split("/");
  const fileName = parts[parts.length - 1].replace(".sql", "");
  const dirName = parts.length > 1 ? parts[parts.length - 2] : "";

  // Check file name first, then directory name
  return FILE_PRIORITY[fileName] ?? FILE_PRIORITY[dirName] ?? 50;
}

/**
 * Recursively find all .sql files in a directory, ordered by dependency priority
 */
export function findSqlFiles(dir: string, basePath: string = ""): SchemaFile[] {
  const files: SchemaFile[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      files.push(...findSqlFiles(fullPath, relativePath));
    } else if (entry.name.endsWith(".sql")) {
      files.push({
        path: relativePath,
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }

  // Sort by priority, then alphabetically within same priority
  return files.sort((a, b) => {
    const priorityA = getFilePriority(a.path);
    const priorityB = getFilePriority(b.path);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.path.localeCompare(b.path);
  });
}

export interface SchemaInspectResult {
  sql: string;
}

/**
 * Diff local schema files against a remote database
 * Uses schema inspect (no Docker required) and compares with local files
 */
export async function diffSchema(
  connectionString: string,
  schemaDir: string,
): Promise<SchemaDiff> {
  // Ensure schema directory exists
  if (!existsSync(schemaDir)) {
    return { files: [], hasChanges: false };
  }

  try {
    // Inspect remote schema
    const remoteSchema = await inspectSchema(connectionString);

    // Read all local schema files (recursively)
    const localFiles = findSqlFiles(schemaDir);

    // Combine all local content for comparison
    const localSchema = localFiles
      .map((f) => f.content)
      .join("\n")
      .trim();
    const remoteNormalized = remoteSchema.sql.trim();

    if (remoteNormalized === localSchema) {
      return { files: [], hasChanges: false };
    }

    // Return files as structured data for rendering
    return {
      files: localFiles,
      hasChanges: true,
    };
  } catch (error) {
    throw new Error(sanitizeError(error));
  }
}

/**
 * Inspect a remote database schema
 */
export async function inspectSchema(
  connectionString: string,
): Promise<SchemaInspectResult> {
  const atlas = getAtlasBinary();
  const excludeFlags = buildExcludeFlags();

  const excludeArgs = excludeFlags.join(" ");

  // Use spawnSync for proper argument handling
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    atlas,
    [
      "schema",
      "inspect",
      "--url",
      connectionString,
      "--format",
      "{{ sql . }}",
      ...EXCLUDED_SCHEMAS.flatMap((s) => ["--exclude", `${s}.*`]),
    ],
    {
      encoding: "utf-8",
      timeout: 60000,
    },
  );

  if (result.error) {
    throw new Error(sanitizeError(result.error));
  }
  if (result.status !== 0) {
    throw new Error(
      sanitizeConnectionString(result.stderr || "Schema inspect failed"),
    );
  }

  return { sql: result.stdout.trim() };
}

/**
 * Apply schema changes to a remote database using Atlas
 *
 * Flow:
 * 1. Write schema files to temp directory (in dependency order)
 * 2. Use remote Supabase as --dev-url (for Atlas to parse SQL)
 * 3. atlas schema apply --url <supabase> --to file://<schema> --dev-url <supabase>
 *
 * Note: Using the same connection for --url and --dev-url works because
 * Atlas uses a separate temporary schema in --dev-url for parsing.
 */
export async function applySchemaWithAtlas(
  connectionString: string,
  schemaDir: string,
): Promise<{ success: boolean; output: string; sql?: string }> {
  console.error("[atlas] applySchemaWithAtlas starting...");
  const atlas = getAtlasBinary();
  console.error("[atlas] Binary found:", atlas);

  const files = findSqlFiles(schemaDir);
  console.error("[atlas] Found", files.length, "SQL files");

  if (files.length === 0) {
    return { success: true, output: "No schema files to apply" };
  }

  // Create temp directory with ordered schema file
  const { tmpdir } = await import("node:os");
  const { rmSync } = await import("node:fs");
  const tempDir = join(tmpdir(), `atlas-schema-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  // Concatenate files in dependency order
  const orderedSql = files
    .map((f) => `-- File: ${f.path}\n${f.content}`)
    .join("\n\n");
  const tempFile = join(tempDir, "schema.sql");
  writeFileSync(tempFile, orderedSql);
  console.error("[atlas] Created schema file:", tempFile);
  console.error("[atlas] File order:", files.map((f) => f.path).join(", "));

  const excludeFlags = buildExcludeFlags();

  try {
    console.error("[atlas] Running atlas schema apply...");
    console.error(
      "[atlas] Target URL:",
      sanitizeConnectionString(connectionString),
    );
    console.error("[atlas] Schema from: file://" + tempDir);
    console.error("[atlas] Dev URL: (same as target)");

    // Use Atlas to compute and apply the diff
    // --url = target database (Supabase)
    // --to = desired state (file:// with our schema)
    // --dev-url = same as target (Supabase has all extensions/types we need)
    const result = spawnSync(
      atlas,
      [
        "schema",
        "apply",
        "--url",
        connectionString,
        "--to",
        `file://${tempDir}`,
        "--dev-url",
        connectionString,
        "--auto-approve",
        ...excludeFlags,
      ],
      {
        encoding: "utf-8",
        timeout: 120000,
      },
    );

    console.error("[atlas] Atlas exited with status:", result.status);
    if (result.stdout)
      console.error("[atlas] stdout:", result.stdout.slice(0, 500));
    if (result.stderr)
      console.error("[atlas] stderr:", result.stderr.slice(0, 500));

    if (result.error) {
      console.error("[atlas] Spawn error:", result.error);
      return {
        success: false,
        output: sanitizeError(result.error),
      };
    }

    if (result.status !== 0) {
      return {
        success: false,
        output: sanitizeConnectionString(
          result.stderr || result.stdout || "Atlas apply failed",
        ),
      };
    }

    return {
      success: true,
      output: sanitizeConnectionString(
        result.stdout?.trim() || "Schema applied",
      ),
      sql: result.stdout?.trim(),
    };
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// PostgreSQL error codes that indicate "already exists" - treat as success
const ALREADY_EXISTS_CODES = [
  "42710", // duplicate_object (type, trigger, policy already exists)
  "42P07", // duplicate_table
  "42P16", // invalid_table_definition (constraint already exists)
];

/**
 * Check if an error is an "already exists" error that can be treated as success
 */
function isAlreadyExistsError(message: string): boolean {
  return (
    ALREADY_EXISTS_CODES.some((code) => message.includes(code)) ||
    message.includes("already exists")
  );
}

/**
 * Apply schema changes to a remote database
 * Uses Management API runQuery to execute SQL files in dependency order
 * Treats "already exists" errors as success (idempotent)
 */
export async function applySchema(
  schemaDir: string,
  runQuery: (sql: string) => Promise<unknown>,
): Promise<{ success: boolean; output: string; applied: string[] }> {
  const files = findSqlFiles(schemaDir);

  if (files.length === 0) {
    return { success: true, output: "No schema files to apply", applied: [] };
  }

  const applied: string[] = [];
  const skipped: string[] = []; // Already exists - treated as success
  const errors: string[] = [];

  for (const file of files) {
    try {
      await runQuery(file.content);
      applied.push(file.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Treat "already exists" as success
      if (isAlreadyExistsError(message)) {
        skipped.push(file.path);
      } else {
        errors.push(`${file.path}: ${message}`);
      }
    }
  }

  const totalSuccess = applied.length + skipped.length;

  if (errors.length > 0 && totalSuccess === 0) {
    return {
      success: false,
      output: `Failed to apply schema:\n${errors.join("\n")}`,
      applied: [],
    };
  }

  let output = `Applied ${applied.length} files`;
  if (skipped.length > 0) {
    output += `, ${skipped.length} unchanged`;
  }
  if (errors.length > 0) {
    output += `. Errors:\n${errors.join("\n")}`;
  }

  return {
    success: true,
    output,
    applied: [...applied, ...skipped], // Include skipped as "applied" since state is correct
  };
}

/**
 * Pull remote schema and write to local files
 */
export async function pullSchema(
  connectionString: string,
  schemaDir: string,
): Promise<{ success: boolean; sql: string }> {
  const result = await inspectSchema(connectionString);

  // Ensure schema directory exists
  mkdirSync(schemaDir, { recursive: true });

  // Write schema to a single file for now
  const schemaPath = join(schemaDir, "schema.sql");
  writeFileSync(schemaPath, result.sql);

  return { success: true, sql: result.sql };
}

/**
 * Check if Atlas is available
 */
export { isPGliteAvailable } from "./pglite-dev.js";

export function isAtlasAvailable(): boolean {
  try {
    getAtlasBinary();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Atlas version
 */
export function getAtlasVersion(): string | null {
  try {
    const atlas = getAtlasBinary();
    const result = execSync(`"${atlas}" version`, { encoding: "utf-8" });
    return result.trim();
  } catch {
    return null;
  }
}
