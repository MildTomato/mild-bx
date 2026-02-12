/**
 * Migration pushing utilities
 *
 * Reads SQL migration files from a directory and applies them to a
 * remote Supabase project via the management API. Returns a result
 * object so the caller can decide how to present progress/errors.
 *
 * Used by bootstrap, init, and other commands that push migrations.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { createClient } from "@/lib/api.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MigrationResult {
  applied: number;
  failed: number;
  total: number;
  errors: Array<{ file: string; error: string }>;
}

export interface PushMigrationsOptions {
  /** Called before each migration is applied */
  onProgress?: (message: string) => void;
  /** Called when a migration fails (non-fatal — continues to next) */
  onWarning?: (message: string) => void;
}

// ─────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────

/**
 * Push SQL migrations from a directory to a remote project.
 *
 * Reads all .sql files in `migrationsDir`, applies them in sorted order.
 * Individual failures are recorded but don't stop the remaining migrations.
 *
 * Returns a result summary so callers can handle spinners/output themselves.
 */
export async function pushMigrations(
  client: ReturnType<typeof createClient>,
  projectRef: string,
  migrationsDir: string,
  options?: PushMigrationsOptions,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    applied: 0,
    failed: 0,
    total: 0,
    errors: [],
  };

  if (!existsSync(migrationsDir)) {
    return result;
  }

  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  result.total = sqlFiles.length;
  if (sqlFiles.length === 0) return result;

  for (const migration of sqlFiles) {
    options?.onProgress?.(`Applying ${migration}...`);

    const migrationPath = join(migrationsDir, migration);
    const content = readFileSync(migrationPath, "utf-8");
    const baseName = migration.replace(".sql", "");
    const parts = baseName.split("_");
    const name = parts.slice(1).join("_");

    try {
      await client.applyMigration(projectRef, content, name);
      result.applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed++;
      result.errors.push({ file: migration, error: message });
      options?.onWarning?.(`Migration ${migration} failed: ${message}`);
    }
  }

  return result;
}
