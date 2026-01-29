/**
 * PGlite dev database for Atlas schema diffing
 * Uses @electric-sql/pglite as an in-memory Postgres for computing diffs
 */

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let devDb: PGlite | null = null;
let socketServer: PGLiteSocketServer | null = null;
let currentPort = 0;

/**
 * Find the auth migrations directory (from submodule)
 */
function findAuthMigrationsDir(): string | null {
  // Walk up from this file to find the repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "vendor", "supabase-auth", "migrations");
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
 * Load and render auth migrations
 * Replaces Go template syntax {{ index .Options "Namespace" }} with "auth"
 */
function loadAuthMigrations(): string[] {
  const migrationsDir = findAuthMigrationsDir();
  if (!migrationsDir) {
    console.error("[pglite] Auth migrations directory not found");
    return [];
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort(); // Migrations are named with timestamps, so sorting gives correct order

  const migrations: string[] = [];

  for (const file of files) {
    let content = readFileSync(join(migrationsDir, file), "utf-8");

    // Replace Go template syntax with "auth"
    content = content.replace(
      /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
      "auth",
    );

    migrations.push(content);
  }

  console.error(`[pglite] Loaded ${migrations.length} auth migrations`);
  return migrations;
}

/**
 * Start a PGlite dev database server with auth schema seeded
 * Returns the connection URL for Atlas to use
 */
export async function startDevDb(): Promise<string> {
  // If already running, return existing URL
  if (devDb && socketServer && currentPort > 0) {
    return `postgres://postgres:postgres@127.0.0.1:${currentPort}/template1?sslmode=disable&binary_parameters=yes`;
  }

  // Stop any existing instance first
  await stopDevDb();

  // Create in-memory PGlite instance using the async factory
  devDb = await PGlite.create();

  // Create required schemas
  console.error("[pglite] Creating schemas...");
  await devDb.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
  `);

  // Seed auth migrations
  console.error("[pglite] Seeding auth migrations...");
  const authMigrations = loadAuthMigrations();

  for (let i = 0; i < authMigrations.length; i++) {
    try {
      await devDb.exec(authMigrations[i]);
    } catch (error) {
      // Some migrations may fail due to missing extensions or features
      // Log but continue - we need the core tables (users, etc.)
      const msg = error instanceof Error ? error.message : String(error);
      // Only log if it's not a benign error
      if (!msg.includes("already exists") && !msg.includes("does not exist")) {
        console.error(`[pglite] Migration ${i} warning: ${msg.slice(0, 100)}`);
      }
    }
  }
  console.error("[pglite] Auth migrations seeded");

  // Try random ports in the ephemeral range (49152-65535)
  let started = false;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    // Generate random port in ephemeral range
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));

    socketServer = new PGLiteSocketServer({
      db: devDb,
      port,
      host: "127.0.0.1",
    });

    try {
      await socketServer.start();
      started = true;
      currentPort = port;
      break;
    } catch (error) {
      lastError = error as Error;
      // Port in use, try another random one
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }

  if (!started) {
    throw (
      lastError ||
      new Error("Failed to start PGlite socket server after 10 attempts")
    );
  }

  // sslmode=disable is required - PGlite doesn't support SSL
  // binary_parameters=yes avoids prepared statements (which PGlite doesn't fully support yet)
  return `postgres://postgres:postgres@127.0.0.1:${currentPort}/template1?sslmode=disable&binary_parameters=yes`;
}

/**
 * Stop the PGlite dev database server
 */
export async function stopDevDb(): Promise<void> {
  if (socketServer) {
    try {
      await socketServer.stop();
    } catch {
      // Ignore errors during cleanup
    }
    socketServer = null;
  }
  if (devDb) {
    try {
      await devDb.close();
    } catch {
      // Ignore errors during cleanup
    }
    devDb = null;
  }
  currentPort = 0;
}

/**
 * Check if PGlite is available
 * Since we import PGlite at module load, if this module loads, PGlite is available
 */
export function isPGliteAvailable(): boolean {
  return (
    typeof PGlite === "function" && typeof PGLiteSocketServer === "function"
  );
}

/**
 * Execute SQL on the dev database
 * Must call startDevDb() first
 */
export async function execOnDevDb(sql: string): Promise<void> {
  if (!devDb) {
    throw new Error("Dev database not started. Call startDevDb() first.");
  }
  await devDb.exec(sql);
}

/**
 * Get the current dev database connection URL
 * Returns null if not started
 */
export function getDevDbUrl(): string | null {
  if (!devDb || !socketServer || currentPort === 0) {
    return null;
  }
  return `postgres://postgres:postgres@127.0.0.1:${currentPort}/template1?sslmode=disable&binary_parameters=yes`;
}
