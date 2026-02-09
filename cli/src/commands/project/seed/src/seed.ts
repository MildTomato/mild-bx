/**
 * Seed command - apply seed files to the database
 */

import { join, relative } from "node:path";
import { existsSync } from "node:fs";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext, resolveConfig, requireTTY } from "@/lib/resolve-project.js";
import {
  applySeedFiles,
  findSeedFiles,
  setVerbose,
  closeSupabasePool,
} from "@/lib/pg-delta.js";
import { getSeedConfig } from "@/lib/seed-config.js";
import { C } from "@/lib/colors.js";

interface SeedOptions {
  profile?: string;
  reset?: boolean;
  json?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

export async function seedCommand(options: SeedOptions): Promise<void> {
  // Set verbose mode
  setVerbose(options.verbose ?? false);

  const { cwd, config, profile, projectRef, token } =
    await resolveProjectContext(options);

  const supabaseDir = join(cwd, "supabase");

  // Get seed config
  const seedConfig = getSeedConfig(config);
  const seedPaths = seedConfig.paths;

  // Find seed files
  const seedFiles = findSeedFiles(seedPaths, supabaseDir);

  if (seedFiles.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "No seed files found" }),
      );
    } else {
      console.error(`\n${C.error}Error:${C.reset} No seed files found`);
      console.error(`  Expected paths: ${seedPaths.join(", ")}`);
      console.error(
        `  Create seed files in ${C.fileName}supabase/seeds/${C.reset}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // Check for db password
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "SUPABASE_DB_PASSWORD not set",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} SUPABASE_DB_PASSWORD environment variable is required`,
      );
      console.error(
        `  Get your database password from the Supabase dashboard\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  // Get connection string
  const client = createClient(token);
  let connectionString: string | undefined;

  try {
    const poolerConfig = await client.getPoolerConfig(projectRef);
    const sessionPooler = poolerConfig.find(
      (p) => p.pool_mode === "session" && p.database_type === "PRIMARY",
    );
    const fallbackPooler = poolerConfig.find(
      (p) => p.database_type === "PRIMARY",
    );
    const pooler = sessionPooler || fallbackPooler;

    if (pooler?.connection_string) {
      connectionString = pooler.connection_string
        .replace("[YOUR-PASSWORD]", dbPassword)
        .replace(":6543/", ":5432/");
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "Failed to get connection string",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} Failed to get database connection`,
      );
      console.error(
        `  ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "No connection string available",
        }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} No database connection available`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!options.json) {
    requireTTY();
  }

  // Dry run - just show what would be seeded
  if (options.dryRun) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "dry_run",
          files: seedFiles.map((f) => relative(supabaseDir, f)),
          count: seedFiles.length,
        }),
      );
    } else {
      console.log("");
      console.log(
        `${C.bold}supa seed${C.reset} ${C.secondary}— dry run${C.reset}`,
      );
      console.log("");
      console.log(
        `${C.secondary}Would apply ${seedFiles.length} seed file(s):${C.reset}`,
      );
      for (const file of seedFiles) {
        console.log(`  ${C.fileName}${relative(supabaseDir, file)}${C.reset}`);
      }
      console.log("");
    }
    return;
  }

  // Apply seeds
  if (!options.json) {
    console.log("");
    console.log(
      `${C.bold}supa seed${C.reset} ${C.secondary}— seeding database${C.reset}`,
    );
    console.log("");
    console.log(
      `${C.secondary}Project:${C.reset} ${C.value}${projectRef}${C.reset}`,
    );
    console.log(
      `${C.secondary}Profile:${C.reset} ${C.value}${profile?.name || "default"}${C.reset}`,
    );
    console.log(
      `${C.secondary}Files:${C.reset}   ${C.value}${seedFiles.length}${C.reset}`,
    );
    console.log("");
  }

  try {
    const result = await applySeedFiles(
      connectionString,
      seedPaths,
      supabaseDir,
    );

    if (options.json) {
      console.log(
        JSON.stringify({
          status: result.success ? "success" : "partial",
          filesApplied: result.filesApplied,
          totalFiles: result.totalFiles,
          errors: result.errors,
        }),
      );
    } else {
      if (result.success) {
        console.log(
          `${C.success}✓${C.reset} Seeded ${C.value}${result.filesApplied}${C.reset} files successfully`,
        );
      } else {
        console.log(
          `${C.warning}⚠${C.reset} Seeded ${C.value}${result.filesApplied}${C.reset}/${result.totalFiles} files`,
        );
        for (const error of result.errors) {
          console.log(
            `  ${C.error}✗${C.reset} ${C.fileName}${error.file}${C.reset}: ${error.error}`,
          );
        }
      }
      console.log("");
    }

    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } else {
      console.error(
        `${C.error}✗${C.reset} Seed failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.log("");
    }
    process.exitCode = 1;
  } finally {
    await closeSupabasePool();
  }
}

export async function seedStatusCommand(options: {
  json?: boolean;
}): Promise<void> {
  const { cwd, config } = resolveConfig(options);
  const supabaseDir = join(cwd, "supabase");

  // Get seed config
  const seedConfig = getSeedConfig(config);

  // Find seed files
  const seedFiles = findSeedFiles(seedConfig.paths, supabaseDir);

  if (options.json) {
    console.log(
      JSON.stringify({
        enabled: seedConfig.enabled,
        paths: seedConfig.paths,
        files: seedFiles.map((f) => relative(supabaseDir, f)),
        count: seedFiles.length,
      }),
    );
  } else {
    console.log("");
    console.log(`${C.bold}Seed Configuration${C.reset}`);
    console.log("");
    console.log(
      `${C.secondary}Enabled:${C.reset} ${seedConfig.enabled ? `${C.success}yes${C.reset}` : `${C.error}no${C.reset}`}`,
    );
    console.log(
      `${C.secondary}Paths:${C.reset}   ${seedConfig.paths.join(", ")}`,
    );
    console.log("");

    if (seedFiles.length === 0) {
      console.log(`${C.warning}No seed files found${C.reset}`);
    } else {
      console.log(
        `${C.secondary}Found ${seedFiles.length} seed file(s):${C.reset}`,
      );
      for (const file of seedFiles) {
        console.log(`  ${C.fileName}${relative(supabaseDir, file)}${C.reset}`);
      }
    }
    console.log("");
  }
}
