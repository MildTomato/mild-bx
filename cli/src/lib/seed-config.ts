/**
 * Seed configuration utilities
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "./config.js";

export interface SeedConfig {
  enabled: boolean;
  paths: string[];
}

/**
 * Get seed configuration from project config
 */
export function getSeedConfig(
  config: ProjectConfig,
  options?: { seed?: boolean; noSeed?: boolean },
  supabaseDir?: string,
): SeedConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbConfig = (config as any)?.db?.seed as
    | { enabled?: boolean; sql_paths?: string[] }
    | undefined;

  const paths = dbConfig?.sql_paths || ["./seed.sql"];

  // Seed is opt-in: enabled only if --seed flag, db.seed config exists,
  // or a seed file is present on disk.
  const seedFileExists = paths.some((p) =>
    existsSync(supabaseDir ? join(supabaseDir, p) : p),
  );
  return {
    enabled:
      options?.seed === true ||
      (options?.noSeed !== true && (dbConfig !== undefined || seedFileExists)),
    paths,
  };
}
