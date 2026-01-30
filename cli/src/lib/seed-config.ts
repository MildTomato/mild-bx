/**
 * Seed configuration utilities
 */

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
): SeedConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbConfig = (config as any)?.db?.seed as
    | { enabled?: boolean; sql_paths?: string[] }
    | undefined;

  return {
    enabled:
      options?.seed === true ||
      (options?.noSeed !== true && dbConfig?.enabled !== false),
    paths: dbConfig?.sql_paths || ["./seed.sql"],
  };
}
