/**
 * Seed helpers for the dev command.
 *
 * The shared primitives (findSeedFiles, applySeedFiles, getSeedConfig) live in
 * @/lib — this module is just the dev-lifecycle glue that both the interactive
 * watcher and the JSON stream path use.
 */

import { applySeedFiles, findSeedFiles } from "@/lib/pg-delta.js";

export interface DevSeedResult {
  skipped: boolean; // true when no seed files were found
  success: boolean;
  filesApplied: number;
  totalFiles: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Run seed files against the database, returning a structured result.
 * Callers handle their own UI/JSON output — this function is pure logic.
 */
export async function applyDevSeed(
  connectionString: string,
  seedPaths: string[],
  supabaseDir: string,
): Promise<DevSeedResult> {
  const files = findSeedFiles(seedPaths, supabaseDir);
  if (files.length === 0) {
    return { skipped: true, success: true, filesApplied: 0, totalFiles: 0, errors: [] };
  }

  const result = await applySeedFiles(connectionString, seedPaths, supabaseDir);
  return { skipped: false, ...result };
}
