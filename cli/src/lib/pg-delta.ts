/**
 * pg-delta integration for schema diffing
 * Uses @supabase/pg-delta for declarative schema management
 * Uses PGlite as the source database (desired state)
 */

import { createPlan, applyPlan } from "@supabase/pg-delta";
import { supabase as supabaseIntegration } from "@supabase/pg-delta/integrations/supabase";
import pg from "pg";
import type { Pool, QueryResult, QueryConfig } from "pg";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { C } from "@/lib/colors.js";

// PGlite is lazy-loaded because it has WASM files that don't bundle correctly
// with Bun's compile. We ship the WASM files alongside the binary and load them manually.
type PGliteType = import("@electric-sql/pglite").PGlite;
let PGliteClass: typeof import("@electric-sql/pglite").PGlite | null = null;
let cachedWasmModule: WebAssembly.Module | null = null;
let cachedFsBundle: Uint8Array | null = null;

class PGliteNotAvailableError extends Error {
  constructor(detail?: string) {
    super(
      "Schema diffing requires PGlite assets.\n" +
      (detail ? `${detail}\n\n` : "") +
      "Ensure pglite.wasm and pglite.data are in the same directory as the binary,\n" +
      "or install via npm: npm install -g @supabase-dx/cli"
    );
    this.name = "PGliteNotAvailableError";
  }
}

/**
 * Export the error class so callers can check for it
 */
export { PGliteNotAvailableError };

/**
 * Find PGlite assets directory - checks multiple locations
 */
function findPGliteAssets(): { wasmPath: string; dataPath: string } | null {
  const candidates: string[] = [];

  // 1. Next to the executable (for compiled binary distribution)
  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, "pglite"));

  // 2. Relative to this source file (for development / pnpm)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From dist/lib/ or src/lib/, go up to cli/bin/pglite
  candidates.push(join(__dirname, "..", "..", "bin", "pglite"));
  // From dist/, go up to cli/bin/pglite
  candidates.push(join(__dirname, "..", "bin", "pglite"));

  // 3. In node_modules (for npm install with externalized pglite)
  candidates.push(join(__dirname, "..", "..", "node_modules", "@electric-sql", "pglite", "dist"));
  candidates.push(join(__dirname, "..", "node_modules", "@electric-sql", "pglite", "dist"));

  // Check each candidate
  for (const dir of candidates) {
    const wasmPath = join(dir, "pglite.wasm");
    const dataPath = join(dir, "pglite.data");
    if (existsSync(wasmPath) && existsSync(dataPath)) {
      log(`[pglite] Found assets in ${dir}`);
      return { wasmPath, dataPath };
    }
  }

  log(`[pglite] Assets not found in any of: ${candidates.join(", ")}`);
  return null;
}

/**
 * Load PGlite WASM and data files from disk
 */
async function loadPGliteAssets(): Promise<{ wasmModule: WebAssembly.Module; fsBundle: Uint8Array }> {
  if (cachedWasmModule && cachedFsBundle) {
    return { wasmModule: cachedWasmModule, fsBundle: cachedFsBundle };
  }

  const assets = findPGliteAssets();
  if (!assets) {
    throw new PGliteNotAvailableError("Could not find pglite.wasm and pglite.data");
  }

  const [wasmBytes, dataBytes] = await Promise.all([
    readFileSync(assets.wasmPath),
    readFileSync(assets.dataPath),
  ]);

  cachedWasmModule = await WebAssembly.compile(wasmBytes);
  cachedFsBundle = dataBytes;

  return { wasmModule: cachedWasmModule, fsBundle: cachedFsBundle };
}

/**
 * Check if we're running in Bun (where PGlite's default loading fails)
 */
function isRunningInBun(): boolean {
  return typeof Bun !== "undefined";
}

/**
 * Lazy-load PGlite, with support for standalone binary and Bun runtime
 */
async function getPGlite(): Promise<PGliteType> {
  if (!PGliteClass) {
    try {
      const module = await import("@electric-sql/pglite");
      PGliteClass = module.PGlite;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("$bunfs") || msg.includes("ENOENT") || msg.includes("Cannot find package")) {
        throw new PGliteNotAvailableError(msg);
      }
      throw error;
    }
  }

  // In Bun, PGlite's default asset loading fails - load from disk first
  if (isRunningInBun()) {
    const assets = findPGliteAssets();
    if (assets) {
      const { wasmModule, fsBundle } = await loadPGliteAssets();
      return await PGliteClass.create({
        wasmModule,
        fsBundle: new Blob([fsBundle]),
      });
    }
    // No assets found - will fail, but let it try (gives better error)
  }

  // Normal path (Node.js or Bun with assets not found)
  try {
    return await PGliteClass.create();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("$bunfs") || msg.includes("ENOENT") || msg.includes("pglite")) {
      throw new PGliteNotAvailableError(msg);
    }
    throw error;
  }
}

/**
 * Verbose logging flag - set via setVerbose()
 */
let verbose = false;

/**
 * Set verbose logging mode
 */
export function setVerbose(value: boolean): void {
  verbose = value;
}

/**
 * Log message only in verbose mode (dim/secondary color)
 */
function log(message: string, ...args: unknown[]): void {
  if (verbose) {
    console.error(`${C.secondary}${message}${C.reset}`, ...args);
  }
}

/**
 * Log warning message only in verbose mode (yellow)
 */
function logWarning(message: string, ...args: unknown[]): void {
  if (verbose) {
    console.error(`${C.warning}${message}${C.reset}`, ...args);
  }
}

/**
 * Log error message only in verbose mode (red)
 */
function logError(message: string, ...args: unknown[]): void {
  if (verbose) {
    console.error(`${C.error}${message}${C.reset}`, ...args);
  }
}

/**
 * Priority order for schema files based on PostgreSQL dependencies
 * Lower number = higher priority (runs first)
 */
const FILE_PRIORITY: Record<string, number> = {
  init: -2, // Init/system SQL runs first (before schemas)
  system: -2,
  misc: -1, // Misc SQL runs before schemas but after init/system
  schemas: 0, // CREATE SCHEMA must come first
  schema: 0,
  extensions: 1,
  types: 2,
  enums: 2,
  domains: 2,
  tables: 3,
  table: 3,
  helpers: 3.5, // Helper functions needed by claims
  rules: 4, // auth_rules.rule() creates views that functions may reference
  claims: 4, // auth_rules claims setup
  indexes: 4.5,
  index: 4.5,
  functions: 5,
  function: 5,
  views: 5, // Views depend on tables
  view: 5,
  triggers: 6,
  trigger: 6,
  data_api: 6.5, // data_api depends on views created by rules
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

  return FILE_PRIORITY[fileName] ?? FILE_PRIORITY[dirName] ?? 50;
}

export interface SchemaFile {
  path: string;
  content: string;
}

/**
 * Schemas that already exist and don't need to be created
 */
const BUILTIN_SCHEMAS = new Set([
  "public",
  "auth",
  "storage",
  "extensions",
  "graphql",
  "graphql_public",
  "realtime",
  "supabase_functions",
  "pgsodium",
  "vault",
]);

/**
 * Organizational folders that are NOT schemas (just for file organization)
 */
const ORGANIZATIONAL_FOLDERS = new Set([
  "misc",
  "init",
  "system",
]);

/**
 * Find all schema directories (excluding built-in ones)
 * Returns schema names that need to be created
 */
export function findCustomSchemas(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const schemas: string[] = [];

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    // Skip builtin schemas and organizational folders
    if (entry.isDirectory() && !BUILTIN_SCHEMAS.has(lowerName) && !ORGANIZATIONAL_FOLDERS.has(lowerName)) {
      // Check if directory has any .sql files
      const subDir = join(dir, entry.name);
      const hasSQL = readdirSync(subDir).some((f) => f.endsWith(".sql"));
      if (hasSQL) {
        schemas.push(entry.name);
      }
    }
  }

  return schemas.sort();
}

/**
 * Generate SQL to create custom schemas
 */
export function generateSchemaCreationSQL(schemas: string[]): string {
  if (schemas.length === 0) return "";

  const statements = schemas.map(
    (schema) =>
      `CREATE SCHEMA IF NOT EXISTS ${schema};\n` +
      `GRANT USAGE ON SCHEMA ${schema} TO anon, authenticated, service_role;`,
  );

  return `-- Auto-generated schema creation\n${statements.join("\n\n")}`;
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
      files.push(...findSqlFiles(fullPath, relativePath));
    } else if (entry.name.endsWith(".sql")) {
      files.push({
        path: relativePath,
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }

  return files.sort((a, b) => {
    const priorityA = getFilePriority(a.path);
    const priorityB = getFilePriority(b.path);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.path.localeCompare(b.path);
  });
}

/**
 * Find a vendor directory by walking up from the current file
 */
function findVendorDir(subpath: string): string | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "vendor", subpath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Find the auth migrations directory (bundled or from submodule)
 */
function findAuthMigrationsDir(): string | null {
  const candidates: string[] = [];

  // 1. Next to executable (for compiled binary)
  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, "auth-migrations"));

  // 2. Relative to this source file (for development / pnpm)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  candidates.push(join(__dirname, "..", "..", "bin", "auth-migrations"));
  candidates.push(join(__dirname, "..", "bin", "auth-migrations"));

  // Check bundled locations first
  for (const dir of candidates) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".up.sql"));
      if (files.length > 0) {
        log(`[pglite] Found auth migrations in ${dir}`);
        return dir;
      }
    }
  }

  // 3. Fall back to vendor submodule (for development)
  const vendorDir = findVendorDir("supabase-auth/migrations");
  if (vendorDir) {
    log(`[pglite] Found auth migrations in vendor: ${vendorDir}`);
    return vendorDir;
  }

  return null;
}

/**
 * Find the postgres init scripts directory (from submodule)
 */
function findPostgresInitDir(): string | null {
  return findVendorDir("supabase-postgres/migrations/db/init-scripts");
}

/**
 * Load the Supabase initial schema and make it PGlite-compatible
 * This sets up roles, default privileges, publications, etc.
 *
 * Instead of trying to parse the complex init script, we use a minimal
 * hardcoded version that sets up just what pg-delta needs to see.
 */
function loadSupabaseInitSchema(): string {
  // Use minimal stubs that are guaranteed to work in PGlite
  // This sets up the essential Supabase roles and privileges that pg-delta expects
  return `
    -- Minimal Supabase role stubs for PGlite
    -- These match what Supabase sets up so pg-delta doesn't see differences
    
    -- Create core API roles
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticator; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    
    -- Create admin/service roles (stubs to prevent diff)
    DO $$ BEGIN CREATE ROLE supabase_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE supabase_auth_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE supabase_storage_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE dashboard_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE pgbouncer; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    
    -- Grant role memberships
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;
    
    -- Grant usage on public schema
    GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
    
    -- Set up default privileges in public schema
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
    
    -- Set up default privileges for supabase_admin (matches Supabase setup)
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    
    -- Grant usage on extensions schema
    GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
    
    -- Create realtime publication
    CREATE PUBLICATION supabase_realtime;
    
    -- Storage schema grants (stub)
    GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  `;
}

/**
 * Load and render auth migrations
 * Throws if the migrations directory is not found
 */
function loadAuthMigrations(): string[] {
  const migrationsDir = findAuthMigrationsDir();
  if (!migrationsDir) {
    throw new Error(
      "Auth migrations directory not found. " +
        "Make sure vendor/supabase-auth submodule is initialized: git submodule update --init",
    );
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No auth migrations found in ${migrationsDir}`);
  }

  const migrations: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(migrationsDir, file), "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to read auth migration ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Replace Go template syntax with 'auth' namespace
    content = content.replace(
      /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
      "auth",
    );
    migrations.push(content);
  }

  return migrations;
}

/**
 * Type OIDs that need special handling (same as pg-delta's postgres-config.js)
 */
const TYPE_PARSERS: Record<number, (val: string) => unknown> = {
  // int2vector - space-separated numbers
  22: (val) => {
    if (!val || val === "") return [];
    return val.trim().split(/\s+/).map(Number);
  },
  // bigint
  20: (val) => BigInt(val),
  // char[]
  1002: (val) => parsePostgresArray(val),
  // text[]
  1009: (val) => parsePostgresArray(val),
  // varchar[]
  1015: (val) => parsePostgresArray(val),
  // int2[]
  1005: (val) => parsePostgresArray(val).map(Number),
  // int4[]
  1007: (val) => parsePostgresArray(val).map(Number),
  // int8[]
  1016: (val) => parsePostgresArray(val).map(Number),
};

/**
 * Parse PostgreSQL array string format: {val1,val2}
 */
function parsePostgresArray(value: string): string[] {
  if (!value || value === "{}") return [];
  const inner = value.slice(1, -1);
  if (inner === "") return [];

  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
  return result;
}

/**
 * Transform row values based on field type OIDs
 */
function transformRowByFieldTypes(
  row: Record<string, unknown>,
  fields: Array<{ name: string; dataTypeID: number }>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };

  for (const field of fields) {
    const value = result[field.name];
    if (value == null) continue;

    // Handle bigint type (20) - convert number to BigInt
    if (field.dataTypeID === 20) {
      if (typeof value === "number") {
        result[field.name] = BigInt(value);
      } else if (typeof value === "string") {
        result[field.name] = BigInt(value);
      }
      // Already bigint is fine
      continue;
    }

    // For other types, only transform strings
    const parser = TYPE_PARSERS[field.dataTypeID];
    if (parser && typeof value === "string") {
      try {
        result[field.name] = parser(value);
      } catch {
        // Keep original value if parsing fails
      }
    }
  }

  return result;
}

/**
 * Create a pg Pool-compatible adapter for PGlite
 * Applies type transformations to match pg-delta's expectations
 */
function createPGlitePool(pglite: PGlite): Pool {
  const pool = {
    async query(
      queryTextOrConfig: string | QueryConfig,
      values?: unknown[],
    ): Promise<QueryResult> {
      let text: string;
      let params: unknown[] | undefined;

      if (typeof queryTextOrConfig === "string") {
        text = queryTextOrConfig;
        params = values;
      } else if (queryTextOrConfig && typeof queryTextOrConfig === "object") {
        text = queryTextOrConfig.text;
        params = queryTextOrConfig.values;
      } else {
        throw new Error("Invalid query format");
      }

      const result = await pglite.query(text, params);

      // Transform rows based on field type OIDs
      const transformedRows = result.rows.map((row) =>
        transformRowByFieldTypes(row as Record<string, unknown>, result.fields),
      );

      return {
        rows: transformedRows,
        rowCount: result.rows.length,
        fields: result.fields as QueryResult["fields"],
        command: "",
        oid: 0,
      };
    },

    async connect() {
      return {
        query: pool.query.bind(pool),
        release: () => {},
      };
    },

    async end() {
      await pglite.close();
    },
  };

  return pool as unknown as Pool;
}

/**
 * Cached Supabase pool - reuse connections across operations
 */
let cachedSupabasePool: Pool | null = null;
let cachedConnectionString: string | null = null;

/**
 * Get or create a pg Pool for Supabase connection
 * Reuses the pool if the connection string matches
 * pg-delta sets up its own type parsers in postgres-config.js, so we don't need transformations
 */
function getSupabasePool(connectionString: string): Pool {
  log(`[pg-pool] Creating pool with connection string: ${sanitizeConnectionString(connectionString)}`);

  // Reuse existing pool if connection string matches
  if (cachedSupabasePool && cachedConnectionString === connectionString) {
    log("[pg-pool] Reusing cached pool");
    return cachedSupabasePool;
  }

  // Close existing pool if different connection string
  if (cachedSupabasePool) {
    log("[pg-pool] Closing previous pool");
    cachedSupabasePool.end().catch(() => {});
  }

  log("[pg-pool] Creating new pg.Pool instance");
  // Create new pool with conservative limits for Supabase
  cachedSupabasePool = new pg.Pool({
    connectionString,
    max: 3, // Max 3 connections (Supabase has limits)
    idleTimeoutMillis: 10000, // Close idle connections after 10s
    connectionTimeoutMillis: 10000, // Connection timeout 10s
  });
  cachedConnectionString = connectionString;

  // Attach error handler to prevent unhandled 'error' event crashes
  // These errors will still be thrown when queries are made, but won't crash the process
  cachedSupabasePool.on("error", (err) => {
    log(`[pg-pool] Connection error: ${err.message}`);
  });

  return cachedSupabasePool;
}

/**
 * Close the cached Supabase pool
 */
export async function closeSupabasePool(): Promise<void> {
  if (cachedSupabasePool) {
    await cachedSupabasePool.end();
    cachedSupabasePool = null;
    cachedConnectionString = null;
  }
}

/**
 * Sanitize connection strings to remove passwords
 */
function sanitizeConnectionString(str: string): string {
  return str.replace(/(postgresql:\/\/[^:]+:)[^@]+(@)/gi, "$1***$2");
}

/**
 * Check if an error is benign/ignorable for PGlite seeding
 * These are errors we expect in PGlite but that don't affect the diff
 */
function isBenignSeedingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  // Extension-related errors (PGlite doesn't support all extensions)
  if (
    lowerMsg.includes("extension") &&
    (lowerMsg.includes("does not exist") ||
      lowerMsg.includes("not available") ||
      lowerMsg.includes("could not open"))
  ) {
    return true;
  }

  // Already exists (idempotent operations)
  if (lowerMsg.includes("already exists")) {
    return true;
  }

  // Duplicate key (already seeded)
  if (lowerMsg.includes("duplicate key")) {
    return true;
  }

  return false;
}

/**
 * Sanitize error messages to remove sensitive data
 */
function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return sanitizeConnectionString(msg);
}

/**
 * Get priority for a SQL statement type (lower = runs first)
 */
function getStatementPriority(stmt: string): number {
  const upper = stmt.toUpperCase().trim();

  // Schemas first
  if (upper.startsWith("CREATE SCHEMA")) return 0;

  // Then grants on schemas
  if (upper.startsWith("GRANT USAGE ON SCHEMA")) return 1;
  if (upper.startsWith("GRANT") && upper.includes("SCHEMA")) return 1;

  // Then types/enums
  if (upper.startsWith("CREATE TYPE")) return 2;

  // Then tables
  if (upper.startsWith("CREATE TABLE")) return 3;

  // Then indexes on tables
  if (upper.startsWith("CREATE INDEX") || upper.startsWith("CREATE UNIQUE INDEX"))
    return 4;

  // Then functions (after tables they might reference)
  if (upper.startsWith("CREATE FUNCTION") || upper.startsWith("CREATE OR REPLACE FUNCTION"))
    return 5;

  // Then views (after functions they might reference)
  if (upper.startsWith("CREATE VIEW") || upper.startsWith("CREATE OR REPLACE VIEW"))
    return 6;

  // Then triggers (after functions and tables)
  if (upper.startsWith("CREATE TRIGGER") || upper.startsWith("CREATE OR REPLACE TRIGGER"))
    return 7;

  // Then table alterations (constraints, etc.)
  if (upper.startsWith("ALTER TABLE")) return 8;

  // Then grants on objects
  if (upper.startsWith("GRANT")) return 9;

  // Everything else
  return 50;
}

/**
 * Sort statements by dependency order
 */
function sortStatementsByDependency(statements: string[]): string[] {
  return [...statements].sort((a, b) => {
    const priorityA = getStatementPriority(a);
    const priorityB = getStatementPriority(b);
    return priorityA - priorityB;
  });
}

/**
 * Extract index name from a DROP INDEX or CREATE INDEX statement
 */
function extractIndexName(stmt: string): string | null {
  // DROP INDEX [IF EXISTS] [schema.]index_name
  const dropMatch = stmt.match(
    /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:\w+\.)?(\w+)/i,
  );
  if (dropMatch) return dropMatch[1].toLowerCase();

  // CREATE INDEX [IF NOT EXISTS] index_name ON ...
  const createMatch = stmt.match(
    /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON/i,
  );
  if (createMatch) return createMatch[1].toLowerCase();

  return null;
}

/**
 * Filter out statements that shouldn't be applied to Supabase
 * These are system-level changes that either:
 * 1. We don't have permission to make (role changes)
 * 2. Would break the Supabase platform (system publications, default privileges)
 * 3. Are in system schemas we shouldn't touch (storage, auth, etc.)
 * 4. Are index drop/create pairs that are essentially recreating the same index
 */
function filterStatements(statements: string[]): string[] {
  const SYSTEM_SCHEMAS = [
    "storage",
    "auth",
    "realtime",
    "supabase_functions",
    "graphql",
    "graphql_public",
    "pgsodium",
    "vault",
    "extensions",
  ];

  // First pass: identify DROP INDEX / CREATE INDEX pairs for the same index
  // These are likely just serialization differences, not actual changes
  const droppedIndexes = new Set<string>();
  const createdIndexes = new Set<string>();

  for (const stmt of statements) {
    const upper = stmt.toUpperCase();
    if (upper.startsWith("DROP INDEX")) {
      const name = extractIndexName(stmt);
      if (name) droppedIndexes.add(name);
    } else if (upper.startsWith("CREATE INDEX")) {
      const name = extractIndexName(stmt);
      if (name) createdIndexes.add(name);
    }
  }

  // Find indexes that are both dropped and created (recreated)
  const recreatedIndexes = new Set<string>();
  for (const name of droppedIndexes) {
    if (createdIndexes.has(name)) {
      recreatedIndexes.add(name);
    }
  }

  if (recreatedIndexes.size > 0) {
    log(
      `[pg-delta] Filtering ${recreatedIndexes.size} recreated indexes (serialization differences)`,
    );
  }

  return statements.filter((stmt) => {
    const upper = stmt.toUpperCase();

    // Filter out SET statements (session settings, not schema changes)
    if (upper.startsWith("SET ")) {
      log(`[pg-delta] Filtered: ${stmt.slice(0, 60)}...`);
      return false;
    }

    // Filter out role alterations (we can't modify roles)
    if (upper.startsWith("ALTER ROLE")) {
      log(`[pg-delta] Filtered: ${stmt.slice(0, 60)}...`);
      return false;
    }

    // Filter out default privilege changes (these are platform-managed)
    if (upper.includes("ALTER DEFAULT PRIVILEGES")) {
      log(`[pg-delta] Filtered: ${stmt.slice(0, 60)}...`);
      return false;
    }

    // Filter out publication changes (supabase_realtime is platform-managed)
    if (
      upper.includes("PUBLICATION") &&
      (upper.includes("DROP") || upper.includes("ALTER"))
    ) {
      log(`[pg-delta] Filtered: ${stmt.slice(0, 60)}...`);
      return false;
    }

    // Filter out GRANT/REVOKE on schema usage (these are platform-managed)
    if (
      (upper.startsWith("GRANT USAGE ON SCHEMA") ||
        upper.startsWith("REVOKE USAGE ON SCHEMA")) &&
      upper.includes("PUBLIC")
    ) {
      log(`[pg-delta] Filtered: ${stmt.slice(0, 60)}...`);
      return false;
    }

    // Filter out recreated indexes (DROP + CREATE for same index = no real change)
    if (upper.startsWith("DROP INDEX") || upper.startsWith("CREATE INDEX")) {
      const indexName = extractIndexName(stmt);
      if (indexName && recreatedIndexes.has(indexName)) {
        // This is a recreated index - filter it out
        return false;
      }
    }

    // Filter out DDL operations on system schemas (but allow references to auth functions in policies)
    for (const schema of SYSTEM_SCHEMAS) {
      // Skip 'auth' for function calls - we want to allow auth.uid() in policies
      // Only filter if the statement is actually operating ON auth schema objects

      // For TABLE operations: CREATE/ALTER/DROP TABLE schema.table
      if (/^(CREATE|ALTER|DROP)\s+TABLE\s+/i.test(upper)) {
        const tablePattern = new RegExp(
          `TABLE\\s+(IF\\s+(NOT\\s+)?EXISTS\\s+)?${schema}\\.`,
          "i",
        );
        if (tablePattern.test(stmt)) {
          log(
            `[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`,
          );
          return false;
        }
      }

      // For POLICY operations: CREATE/ALTER/DROP POLICY name ON schema.table
      if (/^(CREATE|ALTER|DROP)\s+POLICY\s+/i.test(upper)) {
        const policyPattern = new RegExp(`ON\\s+${schema}\\.`, "i");
        if (policyPattern.test(stmt)) {
          log(
            `[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`,
          );
          return false;
        }
      }

      // For INDEX operations: CREATE INDEX ... ON schema.table
      if (/^(CREATE|DROP)\s+(UNIQUE\s+)?INDEX\s+/i.test(upper)) {
        const indexPattern = new RegExp(`ON\\s+${schema}\\.`, "i");
        if (indexPattern.test(stmt)) {
          log(
            `[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`,
          );
          return false;
        }
      }

      // For other DDL: CREATE/ALTER/DROP FUNCTION/TRIGGER/VIEW/TYPE/SEQUENCE schema.name
      if (
        /^(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|VIEW|TYPE|SEQUENCE)\s+/i.test(
          upper,
        )
      ) {
        const objPattern = new RegExp(
          `(FUNCTION|TRIGGER|VIEW|TYPE|SEQUENCE)\\s+${schema}\\.`,
          "i",
        );
        if (objPattern.test(stmt)) {
          log(
            `[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`,
          );
          return false;
        }
      }

      // For IN SCHEMA clauses
      const inSchemaPattern = new RegExp(`IN SCHEMA ${schema}\\b`, "i");
      if (inSchemaPattern.test(stmt)) {
        log(`[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`);
        return false;
      }

      // For constraints/foreign keys referencing system schema tables
      const fkPattern = new RegExp(`REFERENCES\\s+${schema}\\.`, "i");
      if (fkPattern.test(stmt)) {
        log(`[pg-delta] Filtered (${schema} schema): ${stmt.slice(0, 60)}...`);
        return false;
      }

      // For DROP CONSTRAINT on FK constraints to system schemas
      // These get generated because we filter the ADD CONSTRAINT during pull
      if (/DROP\s+CONSTRAINT\s+\w+_fkey/i.test(stmt)) {
        // Check if this is likely a FK to a system schema (by convention, _id_fkey usually references auth.users)
        // This is a heuristic - in a real implementation we'd need to track which FKs were filtered
        if (/profiles_id_fkey/i.test(stmt)) {
          log(`[pg-delta] Filtered (${schema} FK): ${stmt.slice(0, 60)}...`);
          return false;
        }
      }
    }

    return true;
  });
}

export interface DiffResult {
  hasChanges: boolean;
  statements: string[];
  plan: unknown;
}

export interface ApplyResult {
  success: boolean;
  output: string;
  statements?: number;
}

/**
 * Create a migration plan by comparing local schema against remote database
 *
 * Flow:
 * 1. Create PGlite instance (source - desired state)
 * 2. Seed auth migrations
 * 3. Apply local schema files
 * 4. Use pg-delta to diff against remote (target - current state)
 */
export async function diffSchemaWithPgDelta(
  connectionString: string,
  schemaDir: string,
): Promise<DiffResult> {
  log("[pg-delta] Creating PGlite instance...");
  const pglite = await getPGlite();

  try {
    // Create schemas first
    log("[pg-delta] Creating schemas...");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS storage;");

    // Apply Supabase init schema (roles, default privileges, publication)
    log(
      "[pg-delta] Seeding Supabase init schema (roles, privileges, publication)...",
    );
    try {
      const initSchema = loadSupabaseInitSchema();
      await pglite.exec(initSchema);
      log("[pg-delta] ✓ Supabase init schema applied");
    } catch (error) {
      if (!isBenignSeedingError(error)) {
        const msg = sanitizeError(error);
        log(`[pg-delta] ✗ Supabase init schema failed: ${msg}`);
        throw new Error(`Supabase init schema failed: ${msg}`);
      }
    }

    // Seed auth schema from migrations
    log("[pg-delta] Seeding auth migrations...");
    const authMigrations = loadAuthMigrations();
    log(`[pg-delta] Found ${authMigrations.length} auth migrations`);

    for (let i = 0; i < authMigrations.length; i++) {
      const migration = authMigrations[i];
      try {
        await pglite.exec(migration);
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          const msg = sanitizeError(error);
          log(
            `[pg-delta] ✗ Auth migration ${i + 1}/${authMigrations.length} failed: ${msg}`,
          );
          throw new Error(`Auth migration ${i + 1} failed: ${msg}`);
        }
        // Benign error (extension not available, already exists, etc.) - continue
      }
    }

    // Auto-create custom schemas based on directory names
    const customSchemas = findCustomSchemas(schemaDir);
    if (customSchemas.length > 0) {
      log(`[pg-delta] Creating custom schemas: ${customSchemas.join(", ")}`);
      const schemaSQL = generateSchemaCreationSQL(customSchemas);
      try {
        await pglite.exec(schemaSQL);
        log("[pg-delta] ✓ Custom schemas created");
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          const msg = error instanceof Error ? error.message : String(error);
          log(`[pg-delta] ✗ Schema creation failed: ${msg}`);
          throw new Error(`Failed to create schemas: ${msg}`);
        }
      }
    }

    // Apply local schema files
    const files = findSqlFiles(schemaDir);
    log(`[pg-delta] Applying ${files.length} schema files...`);
    log("[pg-delta] Order:", files.map((f) => f.path).join(", "));

    for (const file of files) {
      try {
        await pglite.exec(file.content);
        log(`[pg-delta] ✓ ${file.path}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes("already exists")) {
          log(`[pg-delta] ✗ ${file.path}: ${msg}`);
          throw new Error(`Failed to apply ${file.path}: ${msg}`);
        }
      }
    }

    // Create Pool adapters for both databases
    const pglitePool = createPGlitePool(pglite);

    log("[pg-delta] Creating migration plan...");
    log("[pg-delta] Source: PGlite (desired state)");
    log("[pg-delta] Target connection string length:", connectionString?.length || 0);
    log("[pg-delta] Target (sanitized):", sanitizeConnectionString(connectionString));

    const supabasePool = getSupabasePool(connectionString);

    // pg-delta: source = current state, target = desired state
    // But we want: source = PGlite (desired), target = Supabase (current)
    // So we swap: fromUrl = Supabase, toUrl = PGlite
    // This gives us: "changes to transform Supabase into PGlite state"
    let result;
    try {
      result = await createPlan(
        supabasePool, // from: current state (Supabase)
        pglitePool, // to: desired state (PGlite)
        {
          // Use Supabase integration to filter out system schemas (auth, storage, etc.)
          ...supabaseIntegration,
        },
      );
    } catch (error) {
      log("[pg-delta] createPlan error:", error);
      throw error;
    }

    // Note: Don't close the pool - it's cached and reused across operations

    if (!result) {
      log("[pg-delta] No changes detected");
      return { hasChanges: false, statements: [], plan: null };
    }

    const rawCount = result.plan.statements.length;
    log(`[pg-delta] Raw plan: ${rawCount} changes`);

    // Filter out statements we shouldn't apply (roles, default privileges, system schemas)
    const filteredStatements = filterStatements(result.plan.statements);
    log(`[pg-delta] After filtering: ${filteredStatements.length} changes`);

    // Sort statements by dependency order (schemas -> tables -> functions -> triggers -> etc.)
    const sortedStatements = sortStatementsByDependency(filteredStatements);
    log(`[pg-delta] After sorting: ${sortedStatements.length} changes`);

    if (sortedStatements.length === 0) {
      log(
        `[pg-delta] No changes to apply (${rawCount} raw diff items were filtered out)`,
      );
      return { hasChanges: false, statements: [], plan: null };
    }

    log(`[pg-delta] Found ${sortedStatements.length} changes to apply`);

    // Create a modified plan with sorted statements
    const filteredPlan = {
      ...result.plan,
      statements: sortedStatements,
    };

    return {
      hasChanges: true,
      statements: filteredStatements,
      plan: filteredPlan,
    };
  } finally {
    await pglite.close();
  }
}

/**
 * Apply a migration plan to the remote database
 */
export async function applySchemaWithPgDelta(
  connectionString: string,
  schemaDir: string,
): Promise<ApplyResult> {
  log("[pg-delta] Starting schema apply...");

  // First, create the plan
  const diffResult = await diffSchemaWithPgDelta(connectionString, schemaDir);

  if (!diffResult.hasChanges) {
    return { success: true, output: "No changes to apply" };
  }

  if (!diffResult.plan) {
    return { success: false, output: "Failed to create migration plan" };
  }

  log("[pg-delta] Applying plan...");
  log("[pg-delta] Statements:", diffResult.statements.length);

  // We need PGlite again to apply the plan (pg-delta verifies fingerprints)
  const pglite = await getPGlite();

  try {
    // Create schemas first
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS storage;");

    // Apply Supabase init schema (roles, default privileges, publication)
    try {
      const initSchema = loadSupabaseInitSchema();
      await pglite.exec(initSchema);
    } catch (error) {
      if (!isBenignSeedingError(error)) {
        const msg = sanitizeError(error);
        throw new Error(`Supabase init schema failed: ${msg}`);
      }
    }

    // Seed auth schema from migrations
    const authMigrations = loadAuthMigrations();
    for (let i = 0; i < authMigrations.length; i++) {
      const migration = authMigrations[i];
      try {
        await pglite.exec(migration);
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          const msg = sanitizeError(error);
          log(
            `[pg-delta] ✗ Auth migration ${i + 1}/${authMigrations.length} failed: ${msg}`,
          );
          throw new Error(`Auth migration ${i + 1} failed: ${msg}`);
        }
      }
    }

    // Auto-create custom schemas based on directory names
    const customSchemas = findCustomSchemas(schemaDir);
    if (customSchemas.length > 0) {
      const schemaSQL = generateSchemaCreationSQL(customSchemas);
      try {
        await pglite.exec(schemaSQL);
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          const msg = sanitizeError(error);
          throw new Error(`Failed to create schemas: ${msg}`);
        }
      }
    }

    const files = findSqlFiles(schemaDir);
    for (const file of files) {
      try {
        await pglite.exec(file.content);
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          const msg = sanitizeError(error);
          log(`[pg-delta] ✗ ${file.path}: ${msg}`);
          throw new Error(`Failed to apply ${file.path}: ${msg}`);
        }
      }
    }

    const pglitePool = createPGlitePool(pglite);
    const supabasePool = getSupabasePool(connectionString);

    // Apply the plan
    // Note: Don't close the pool - it's cached and reused across operations
    const applyResult = await applyPlan(
      diffResult.plan as Parameters<typeof applyPlan>[0],
      supabasePool, // from: current (Supabase)
      pglitePool, // to: desired (PGlite)
    );

    log("[pg-delta] Apply result:", applyResult.status);

    switch (applyResult.status) {
      case "applied":
        return {
          success: true,
          output: `Applied ${applyResult.statements} statements`,
          statements: applyResult.statements,
        };
      case "already_applied":
        return { success: true, output: "Already applied" };
      case "fingerprint_mismatch":
        return {
          success: false,
          output: `Database changed since plan was created. Expected: ${applyResult.expected}, Current: ${applyResult.current}`,
        };
      case "invalid_plan":
        return {
          success: false,
          output: `Invalid plan: ${applyResult.message}`,
        };
      case "failed":
        return {
          success: false,
          output: `Failed: ${applyResult.error instanceof Error ? applyResult.error.message : String(applyResult.error)}`,
        };
      default:
        return { success: false, output: "Unknown result" };
    }
  } finally {
    await pglite.close();
  }
}

export interface SeedResult {
  success: boolean;
  filesApplied: number;
  totalFiles: number;
  errors: { file: string; error: string }[];
}

/**
 * Apply seed files to the remote database
 *
 * Seed files are applied directly to Supabase via the pg Pool.
 * Each file is executed in order, with errors collected but not stopping execution.
 */
export async function applySeedFiles(
  connectionString: string,
  seedPaths: string[],
  baseDir: string,
): Promise<SeedResult> {
  const pool = getSupabasePool(connectionString);
  const errors: { file: string; error: string }[] = [];
  let filesApplied = 0;

  // Resolve and sort seed files
  const resolvedFiles: { path: string; content: string }[] = [];

  for (const pattern of seedPaths) {
    // Resolve relative to baseDir (supabase directory)
    const fullPattern = join(baseDir, pattern);

    // Simple glob support: if pattern contains *, find matching files
    if (pattern.includes("*")) {
      const dir = dirname(fullPattern);
      const filePattern = fullPattern.split("/").pop() || "*";
      const regex = new RegExp("^" + filePattern.replace(/\*/g, ".*") + "$");

      if (existsSync(dir)) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && regex.test(entry.name)) {
            const filePath = join(dir, entry.name);
            try {
              resolvedFiles.push({
                path: filePath,
                content: readFileSync(filePath, "utf-8"),
              });
            } catch (error) {
              errors.push({
                file: filePath,
                error: `Failed to read: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }
        }
      }
    } else {
      // Direct file path
      if (existsSync(fullPattern)) {
        try {
          resolvedFiles.push({
            path: fullPattern,
            content: readFileSync(fullPattern, "utf-8"),
          });
        } catch (error) {
          errors.push({
            file: fullPattern,
            error: `Failed to read: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }

  // Sort by filename for consistent ordering
  resolvedFiles.sort((a, b) => a.path.localeCompare(b.path));

  log(`[seed] Found ${resolvedFiles.length} seed files`);

  // Apply each seed file
  for (const file of resolvedFiles) {
    const relativePath = file.path.replace(baseDir + "/", "");
    log(`[seed] Applying ${relativePath}...`);

    try {
      await pool.query(file.content);
      filesApplied++;
      log(`[seed] ✓ ${relativePath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Check if it's a benign error (duplicate key, etc.)
      if (isBenignSeedingError(error)) {
        log(`[seed] ⊘ ${relativePath} (already seeded)`);
        filesApplied++; // Count as applied since data exists
      } else {
        log(`[seed] ✗ ${relativePath}: ${msg}`);
        errors.push({ file: relativePath, error: msg });
      }
    }
  }

  return {
    success: errors.length === 0,
    filesApplied,
    totalFiles: resolvedFiles.length,
    errors,
  };
}

/**
 * Find seed files based on config patterns
 */
export function findSeedFiles(patterns: string[], baseDir: string): string[] {
  const files: string[] = [];

  for (const pattern of patterns) {
    const fullPattern = join(baseDir, pattern);

    if (pattern.includes("*")) {
      const dir = dirname(fullPattern);
      const filePattern = fullPattern.split("/").pop() || "*";
      const regex = new RegExp("^" + filePattern.replace(/\*/g, ".*") + "$");

      if (existsSync(dir)) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && regex.test(entry.name)) {
            files.push(join(dir, entry.name));
          }
        }
      }
    } else {
      if (existsSync(fullPattern)) {
        files.push(fullPattern);
      }
    }
  }

  return files.sort();
}

export interface PullResult {
  success: boolean;
  files: { path: string; content: string }[];
  statements: string[];
  error?: string;
}

/**
 * Pull schema from remote database to local files
 *
 * Flow:
 * 1. Create empty PGlite with Supabase system setup (roles, etc.)
 * 2. Use pg-delta to diff empty PGlite against Supabase
 * 3. The diff statements ARE the schema (CREATE TABLE, etc.)
 * 4. Organize statements into files by type
 */
export async function pullSchemaWithPgDelta(
  connectionString: string,
  schemaDir: string,
): Promise<PullResult> {
  log("[pg-delta] Starting schema pull...");
  const pglite = await getPGlite();

  try {
    // Create schemas
    log("[pg-delta] Creating schemas...");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions;");
    await pglite.exec("CREATE SCHEMA IF NOT EXISTS storage;");

    // Apply Supabase init schema (roles, default privileges, publication)
    log("[pg-delta] Seeding Supabase init schema...");
    try {
      const initSchema = loadSupabaseInitSchema();
      await pglite.exec(initSchema);
    } catch (error) {
      if (!isBenignSeedingError(error)) {
        const msg = sanitizeError(error);
        return {
          success: false,
          files: [],
          statements: [],
          error: `Init schema failed: ${msg}`,
        };
      }
    }

    // Seed auth migrations (so pg-delta doesn't see auth schema as different)
    log("[pg-delta] Seeding auth migrations...");
    const authMigrations = loadAuthMigrations();
    for (const migration of authMigrations) {
      try {
        await pglite.exec(migration);
      } catch (error) {
        if (!isBenignSeedingError(error)) {
          // Continue - auth migrations may have issues in PGlite
        }
      }
    }

    // DON'T apply local schema files - we want to see what's in Supabase

    const pglitePool = createPGlitePool(pglite);
    const supabasePool = getSupabasePool(connectionString);

    log("[pg-delta] Creating pull plan...");
    log("[pg-delta] From: PGlite (empty)");
    log("[pg-delta] To: Supabase (remote)");

    let result;
    try {
      // Reversed order: we want statements to make empty PGlite match Supabase
      result = await createPlan(
        pglitePool, // from: empty PGlite
        supabasePool, // to: Supabase (what we want)
        {
          ...supabaseIntegration,
        },
      );
    } catch (error) {
      const msg = sanitizeError(error);
      return {
        success: false,
        files: [],
        statements: [],
        error: `createPlan failed: ${msg}`,
      };
    }

    // Note: Don't close the pool - it's cached and reused across operations

    if (!result || result.plan.statements.length === 0) {
      log("[pg-delta] No schema found in remote");
      return { success: true, files: [], statements: [] };
    }

    log(`[pg-delta] Found ${result.plan.statements.length} statements`);

    // Filter out system statements (same as push)
    const statements = filterStatements(result.plan.statements);
    log(`[pg-delta] After filtering: ${statements.length} statements`);

    // Organize statements into files by type
    const files = organizeStatementsIntoFiles(statements, schemaDir);

    return {
      success: true,
      files,
      statements,
    };
  } finally {
    await pglite.close();
  }
}

/**
 * Organize SQL statements into files by type
 */
function organizeStatementsIntoFiles(
  statements: string[],
  schemaDir: string,
): { path: string; content: string }[] {
  const types: string[] = [];
  const tables: string[] = [];
  const indexes: string[] = [];
  const functions: string[] = [];
  const triggers: string[] = [];
  const policies: string[] = [];
  const grants: string[] = [];
  const other: string[] = [];

  for (const stmt of statements) {
    const upper = stmt.toUpperCase().trim();

    if (upper.startsWith("CREATE TYPE") || upper.startsWith("ALTER TYPE")) {
      types.push(stmt);
    } else if (
      upper.startsWith("CREATE TABLE") ||
      upper.startsWith("ALTER TABLE")
    ) {
      // Separate RLS enables from table definitions
      if (
        upper.includes("ENABLE ROW LEVEL SECURITY") ||
        upper.includes("FORCE ROW LEVEL SECURITY")
      ) {
        policies.push(stmt);
      } else {
        tables.push(stmt);
      }
    } else if (
      upper.startsWith("CREATE INDEX") ||
      upper.startsWith("DROP INDEX")
    ) {
      indexes.push(stmt);
    } else if (
      upper.startsWith("CREATE FUNCTION") ||
      upper.startsWith("CREATE OR REPLACE FUNCTION")
    ) {
      functions.push(stmt);
    } else if (
      upper.startsWith("CREATE TRIGGER") ||
      upper.startsWith("DROP TRIGGER")
    ) {
      triggers.push(stmt);
    } else if (
      upper.startsWith("CREATE POLICY") ||
      upper.startsWith("DROP POLICY") ||
      upper.startsWith("ALTER POLICY")
    ) {
      policies.push(stmt);
    } else if (upper.startsWith("GRANT") || upper.startsWith("REVOKE")) {
      grants.push(stmt);
    } else {
      other.push(stmt);
    }
  }

  const files: { path: string; content: string }[] = [];
  const basePath = join(schemaDir, "public");

  if (types.length > 0) {
    files.push({
      path: join(basePath, "types.sql"),
      content: `-- Custom types for public schema\n\n${types.join(";\n\n")};\n`,
    });
  }

  if (tables.length > 0) {
    files.push({
      path: join(basePath, "tables.sql"),
      content: `-- Tables for public schema\n\n${tables.join(";\n\n")};\n`,
    });
  }

  if (indexes.length > 0) {
    files.push({
      path: join(basePath, "indexes.sql"),
      content: `-- Indexes for public schema\n\n${indexes.join(";\n\n")};\n`,
    });
  }

  if (functions.length > 0) {
    files.push({
      path: join(basePath, "functions.sql"),
      content: `-- Functions for public schema\n\n${functions.join(";\n\n")};\n`,
    });
  }

  if (triggers.length > 0) {
    files.push({
      path: join(basePath, "triggers.sql"),
      content: `-- Triggers for public schema\n\n${triggers.join(";\n\n")};\n`,
    });
  }

  if (policies.length > 0) {
    files.push({
      path: join(basePath, "rls.sql"),
      content: `-- Row Level Security for public schema\n\n${policies.join(";\n\n")};\n`,
    });
  }

  if (grants.length > 0) {
    files.push({
      path: join(basePath, "grants.sql"),
      content: `-- Grants and permissions for public schema\n\n${grants.join(";\n\n")};\n`,
    });
  }

  return files;
}
