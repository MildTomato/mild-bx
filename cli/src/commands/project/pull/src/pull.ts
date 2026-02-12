/**
 * Pull command - pull remote state to local
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext, requireTTY } from "@/lib/resolve-project.js";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  buildApiConfigFromRemote,
  buildAuthConfigFromRemote,
  type ConfigDiff,
  type ProjectConfig,
} from "@/lib/sync.js";
import { pullSchemaWithPgDelta, setVerbose } from "@/lib/pg-delta.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { C } from "@/lib/colors.js";

interface PullOptions {
  profile?: string;
  plan?: boolean;
  typesOnly?: boolean;
  schemas?: string;
  json?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

function printConfigDiffs(diffs: ConfigDiff[], label: string) {
  const changes = diffs.filter((d) => d.changed);
  if (changes.length === 0) return;

  console.log(chalk.dim(`\n${label}:`));
  for (const diff of changes) {
    console.log(`  ${chalk.yellow(diff.key)}: ${chalk.red(String(diff.local))} → ${chalk.green(String(diff.remote))}`);
  }
}

export async function pullCommand(options: PullOptions) {
  const dryRun = options.plan ?? false;
  const typesOnly = options.typesOnly ?? false;
  const schemas = options.schemas ?? "public";

  setVerbose(options.verbose ?? false);

  const { cwd, config, branch: currentBranch, profile, projectRef, token } =
    await resolveProjectContext(options);

  const client = createClient(token);

  if (!options.json) {
    requireTTY();
  }

  // JSON mode
  if (options.json) {
    try {
      const project = await client.getProject(projectRef);

      if (project.status === "INACTIVE") {
        console.log(JSON.stringify({
          status: "error",
          message: "Project is paused",
          dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
        }));
        process.exit(1);
      }

      const result: Record<string, unknown> = {
        status: "success",
        profile: profile?.name,
        projectRef,
        dryRun,
      };

      if (typesOnly) {
        const typesResp = await client.getTypescriptTypes(projectRef, schemas);
        if (!dryRun) {
          const typesPath = join(cwd, "supabase", "types", "database.ts");
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, typesResp.types);
          result.typesWritten = true;
        }
        result.message = "TypeScript types generated";
      } else {
        result.project = project;
        if (!dryRun) {
          const typesResp = await client.getTypescriptTypes(projectRef, schemas);
          const typesPath = join(cwd, "supabase", "types", "database.ts");
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, typesResp.types);
          result.typesWritten = true;
        }
      }

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Pull failed",
      }));
    }
    return;
  }

  // Interactive mode
  printCommandHeader({
    command: "supa project pull",
    description: ["Pull remote state to local."],
  });
  console.log(S_BAR);
  console.log(`${S_BAR}  ${C.secondary}Project:${C.reset}  ${projectRef}`);
  console.log(`${S_BAR}  ${C.secondary}Profile:${C.reset}  ${profile?.name || "default"}`);
  if (currentBranch) {
    console.log(`${S_BAR}  ${C.secondary}Branch:${C.reset}   ${currentBranch}`);
  }
  if (typesOnly) {
    console.log(`${S_BAR}  ${C.secondary}Mode:${C.reset}     types only`);
  }
  if (dryRun) {
    console.log(`${S_BAR}  ${C.warning}Mode:${C.reset}     ${C.warning}plan (dry-run)${C.reset}`);
  }
  console.log(S_BAR);

  const spinner = p.spinner();
  spinner.start("Fetching remote state...");

  try {
    // Check project status
    const project = await client.getProject(projectRef);

    if (project.status === "INACTIVE") {
      spinner.stop(chalk.red("Project is paused"));
      console.log(chalk.dim(`Restore from: https://supabase.com/dashboard/project/${projectRef}`));
      process.exit(1);
    }

    if (project.status !== "ACTIVE_HEALTHY" && project.status !== "ACTIVE_UNHEALTHY") {
      spinner.stop(chalk.red(`Project not ready (${project.status})`));
      process.exit(1);
    }

    // Types only mode
    if (typesOnly) {
      spinner.message("Generating TypeScript types...");
      const typesResp = await client.getTypescriptTypes(projectRef, schemas);

      if (dryRun) {
        spinner.stop("Types preview (dry run)");
        console.log(chalk.dim("\nWould write: supabase/types/database.ts"));
      } else {
        const typesPath = join(cwd, "supabase", "types", "database.ts");
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, typesResp.types);
        spinner.stop(chalk.green("Types updated"));
        console.log(chalk.dim("  Wrote supabase/types/database.ts"));
      }
      return;
    }

    // Fetch and compare configs
    const projectConfig = config as ProjectConfig;
    let postgrestDiffs: ConfigDiff[] = [];
    let authDiffs: ConfigDiff[] = [];

    try {
      const remotePostgrest = await client.getPostgrestConfig(projectRef);
      const localPostgrest = buildPostgrestPayload(projectConfig);
      if (localPostgrest) {
        postgrestDiffs = compareConfigs(
          localPostgrest as Record<string, unknown>,
          remotePostgrest as Record<string, unknown>
        );
      }
    } catch { /* ignore */ }

    try {
      const remoteAuth = await client.getAuthConfig(projectRef);
      const localAuth = buildAuthPayload(projectConfig);
      if (localAuth) {
        authDiffs = compareConfigs(
          localAuth as Record<string, unknown>,
          remoteAuth as Record<string, unknown>
        );
      }
    } catch { /* ignore */ }

    const hasConfigChanges =
      postgrestDiffs.some((d) => d.changed) ||
      authDiffs.some((d) => d.changed);

    spinner.stop("Fetched remote state");

    // Show config diffs if any
    if (hasConfigChanges) {
      printConfigDiffs(postgrestDiffs, "API config changes");
      printConfigDiffs(authDiffs, "Auth config changes");
    }

    // Dry run - just show what would happen
    if (dryRun) {
      console.log(chalk.dim("\nWould write:"));
      if (hasConfigChanges) console.log(chalk.dim("  supabase/config.json"));
      console.log(chalk.dim("  supabase/types/database.ts"));
      console.log(chalk.dim("  supabase/schema/public/*.sql"));
      console.log(chalk.yellow("\n(dry run - no changes applied)"));
      return;
    }

    // Confirm if there are config changes (unless --yes)
    if (hasConfigChanges && !options.yes) {
      const proceed = await p.confirm({
        message: "Pull these changes?",
      });

      if (p.isCancel(proceed) || !proceed) {
        p.cancel("Cancelled");
        process.exit(0);
      }
    }

    // Apply changes
    const applySpinner = p.spinner();
    applySpinner.start("Writing files...");

    let configUpdated = false;
    let typesUpdated = false;
    let schemaUpdated = false;

    // Update config
    if (hasConfigChanges) {
      const configPath = join(cwd, "supabase", "config.json");
      try {
        const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        const remotePostgrest = await client.getPostgrestConfig(projectRef);
        const remoteAuth = await client.getAuthConfig(projectRef);

        const apiConfig = buildApiConfigFromRemote(remotePostgrest as Record<string, unknown>);
        const authConfig = buildAuthConfigFromRemote(remoteAuth as Record<string, unknown>);

        const updatedConfig = {
          ...existingConfig,
          api: { ...existingConfig.api, ...apiConfig },
          auth: { ...existingConfig.auth, ...authConfig },
        };

        writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + "\n");
        configUpdated = true;
      } catch { /* ignore */ }
    }

    // Generate types
    try {
      const typesResp = await client.getTypescriptTypes(projectRef, schemas);
      const typesPath = join(cwd, "supabase", "types", "database.ts");
      mkdirSync(dirname(typesPath), { recursive: true });

      let existingTypes = "";
      try { existingTypes = readFileSync(typesPath, "utf-8"); } catch { /* ignore */ }

      if (typesResp.types !== existingTypes) {
        writeFileSync(typesPath, typesResp.types);
        typesUpdated = true;
      }
    } catch { /* ignore */ }

    // Pull schema with pg-delta
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    if (dbPassword) {
      try {
        const poolerConfig = await client.getPoolerConfig(projectRef);
        const sessionPooler = poolerConfig.find(
          (p: { pool_mode: string; database_type: string }) =>
            p.pool_mode === "session" && p.database_type === "PRIMARY"
        );
        const fallbackPooler = poolerConfig.find(
          (p: { database_type: string }) => p.database_type === "PRIMARY"
        );
        const pooler = sessionPooler || fallbackPooler;

        if (pooler?.connection_string) {
          const connectionString = pooler.connection_string
            .replace("[YOUR-PASSWORD]", dbPassword)
            .replace(":6543/", ":5432/");
          const schemaDir = join(cwd, "supabase", "schema");

          const result = await pullSchemaWithPgDelta(connectionString, schemaDir);
          if (result.success && result.files.length > 0) {
            for (const file of result.files) {
              mkdirSync(dirname(file.path), { recursive: true });
              writeFileSync(file.path, file.content);
            }
            schemaUpdated = true;
          }
        }
      } catch { /* ignore */ }
    }

    const anythingUpdated = configUpdated || typesUpdated || schemaUpdated;
    applySpinner.stop(anythingUpdated ? chalk.green("Pull complete") : "Everything up to date");

    if (configUpdated) console.log(chalk.dim("  Updated supabase/config.json"));
    if (typesUpdated) console.log(chalk.dim("  Updated supabase/types/database.ts"));
    if (schemaUpdated) console.log(chalk.dim("  Updated supabase/schema/public/*.sql"));

  } catch (error) {
    spinner.stop(chalk.red("Pull failed"));
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
