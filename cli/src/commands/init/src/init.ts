/**
 * Init command - initialize a new supabase project
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@/lib/api.js";
import { requireAuth, loadProjectConfig, getWorkflowProfile } from "@/lib/config.js";
import { type Region, REGIONS } from "@/lib/constants.js";
import { createProject as createProjectOp } from "@/lib/operations.js";
import { buildApiConfigFromRemote, buildAuthConfigFromRemote } from "@/lib/sync.js";
import { WORKFLOW_PROFILES } from "@/lib/workflow-profiles.js";
import type { WorkflowProfile, SchemaManagement, ConfigSource } from "@/lib/config-types.js";
import { runInitWizard, type InitResult } from "@/components/InitWizard.js";
import { S_BAR } from "@/components/command-header.js";

interface InitOptions {
  yes?: boolean;
  json?: boolean;
  org?: string;
  project?: string;
  name?: string;
  region?: string;
  dryRun?: boolean;
  local?: boolean;
}

interface ConfigData {
  projectId: string;
  workflowProfile: WorkflowProfile;
  schemaManagement: SchemaManagement;
  configSource: ConfigSource;
  api?: ReturnType<typeof buildApiConfigFromRemote>;
  auth?: ReturnType<typeof buildAuthConfigFromRemote>;
}

function buildConfigJson(data: ConfigData): string {
  const config: Record<string, unknown> = {
    $schema: "../../../cli/config-schema/config.schema.json",
    project_id: data.projectId,
    workflow_profile: data.workflowProfile,
    schema_management: data.schemaManagement,
    config_source: data.configSource,
  };

  if (data.api && Object.keys(data.api).length > 0) {
    config.api = data.api;
  }

  if (data.auth && Object.keys(data.auth).length > 0) {
    config.auth = data.auth;
  }

  return JSON.stringify(config, null, 2);
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const supabaseDir = join(cwd, "supabase");

  // Check if already initialized
  if (existsSync(join(supabaseDir, "config.json"))) {
    const config = loadProjectConfig(cwd);
    const projectId = config?.project_id;

    // Case: local init was run previously (no project_id) — offer to connect to platform
    if (!projectId && !options.json && process.stdin.isTTY && !options.local) {
      console.log();
      p.log.info("Found existing local project (no cloud project linked).");

      const reInitAction = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "connect" as const, label: "Connect to Supabase Platform", hint: "Link or create a cloud project" },
          { value: "reinit" as const, label: "Re-initialize", hint: "Start fresh" },
          { value: "cancel" as const, label: "Cancel" },
        ],
      });

      if (p.isCancel(reInitAction) || reInitAction === "cancel") {
        p.cancel("Cancelled");
        return;
      }

      if (reInitAction === "reinit") {
        // Fall through to the rest of init (will overwrite)
      } else {
        // "connect" — go straight to platform wizard
        const token = await requireAuth({ json: options.json });
        const project = await runInitWizard();
        await writePlatformProject(cwd, supabaseDir, token, project, options);
        return;
      }
    } else if (projectId) {
      // Case: fully initialized with a project — show current state
      const profile = config ? getWorkflowProfile(config) : "unknown";
      const dashboardUrl = `https://supabase.com/dashboard/project/${projectId}`;
      const profileDef = WORKFLOW_PROFILES.find((pr) => pr.name === profile);

      if (options.json) {
        console.log(JSON.stringify({
          status: "already_initialized",
          project_id: projectId,
          workflow_profile: profile,
          dashboard_url: dashboardUrl,
          config_path: join(supabaseDir, "config.json"),
        }));
      } else {
        console.log();
        console.log("Already initialized in this directory.");
        console.log();
        console.log(`${chalk.dim("Project:")} ${projectId}`);
        console.log(`${chalk.dim("Config:")} supabase/config.json`);
        console.log(`${chalk.dim("Profile:")} ${profile}`);
        if (profileDef) {
          console.log();
          console.log(chalk.bold(profileDef.title));
          console.log(chalk.dim(profileDef.description));
        }
        console.log();
        console.log(chalk.dim("Next steps:"));
        console.log(`  supa dev  ${chalk.dim("Start development watcher")}`);
        console.log(`  supa project profile  ${chalk.dim("Change workflow profile")}`);
        console.log(`  supa status  ${chalk.dim("Show project status")}`);
      }
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Non-interactive: --local flag
  // ─────────────────────────────────────────────────────────────

  if (options.local) {
    runLocalInit(cwd, supabaseDir, options);
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // Non-interactive: platform flags (--project, --org/--name/--region)
  // ─────────────────────────────────────────────────────────────

  const token = await requireAuth({ json: options.json });

  let project: InitResult;

  // Non-interactive mode: use flags if provided
  if (options.project) {
    const client = createClient(token);
    try {
      const projects = await client.listProjects();
      const found = projects.find((pr) => pr.ref === options.project);
      if (!found) {
        if (options.json) {
          console.log(JSON.stringify({ status: "error", message: `Project not found: ${options.project}` }));
        } else {
          console.error(`Error: Project not found: ${options.project}`);
        }
        process.exit(1);
      }
      project = { ref: found.ref, name: found.name, schemaManagement: "declarative", configSource: "code", workflowProfile: "solo" };
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ status: "error", message: err instanceof Error ? err.message : "Failed to fetch projects" }));
      } else {
        console.error("Error:", err instanceof Error ? err.message : "Failed to fetch projects");
      }
      process.exit(1);
    }
  } else if (options.org && options.name && options.region) {
    const validRegions = REGIONS.map((r) => r.value);
    if (!validRegions.includes(options.region as Region)) {
      if (options.json) {
        console.log(JSON.stringify({ status: "error", message: `Invalid region: ${options.region}. Valid regions: ${validRegions.join(", ")}` }));
      } else {
        console.error(`Error: Invalid region: ${options.region}`);
        console.error(`Valid regions: ${validRegions.join(", ")}`);
      }
      process.exit(1);
    }

    try {
      if (!options.json) {
        console.log(`Creating project "${options.name}" in ${options.region}...`);
      }
      const { project: newProject, dbPassword } = await createProjectOp({
        token,
        orgSlug: options.org,
        region: options.region as Region,
        name: options.name,
      });
      project = { ref: newProject.ref, name: options.name, schemaManagement: "declarative", configSource: "code", workflowProfile: "solo", dbPassword };
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ status: "error", message: err instanceof Error ? err.message : "Failed to create project" }));
      } else {
        console.error("Error:", err instanceof Error ? err.message : "Failed to create project");
      }
      process.exit(1);
    }
  } else if (options.org || options.name || options.region) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "To create a new project non-interactively, provide all of: --org, --name, --region. Or use --project to link to an existing project." }));
    } else {
      console.error("Error: To create a new project non-interactively, provide all of: --org, --name, --region");
      console.error("Or use --project <ref> to link to an existing project.");
    }
    process.exit(1);
  } else if (options.json || !process.stdin.isTTY) {
    if (options.json) {
      console.log(JSON.stringify({
        status: "error",
        message: "Non-interactive mode requires flags. Use --project <ref> for existing project, or --org, --name, --region for new project.",
        hint: 'Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.',
      }));
    } else {
      console.error("Error: Non-interactive mode requires flags.");
      console.error("Use --project <ref> for existing project, or --org, --name, --region for new project.");
      console.error('Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.');
    }
    process.exit(1);
  } else {
    // ─────────────────────────────────────────────────────────────
    // Interactive mode: gateway question
    // ─────────────────────────────────────────────────────────────

    const { printCommandHeader } = await import("@/components/command-header.js");

    printCommandHeader({
      command: "supa init",
      description: [
        "Initialize a new Supabase project in this directory.",
      ],
      showBranding: true,
    });

    const developmentMode = await p.select({
      message: "How would you like to develop?",
      options: [
        { value: "local" as const, label: "Local development", hint: "No account needed, connect to cloud later" },
        { value: "connect" as const, label: "Connect to existing project", hint: "Link to a project on Supabase Platform" },
        { value: "create" as const, label: "Create a new project", hint: "Set up a new project on Supabase Platform" },
      ],
    });

    if (p.isCancel(developmentMode)) {
      p.cancel("Cancelled");
      return;
    }

    if (developmentMode === "local") {
      runLocalInit(cwd, supabaseDir, options);
      return;
    }

    // Platform paths — need auth, then run wizard
    const platformToken = await requireAuth({ json: options.json });
    project = await runInitWizard();
    await writePlatformProject(cwd, supabaseDir, platformToken, project, options);
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // Non-interactive platform flow (flags were provided)
  // ─────────────────────────────────────────────────────────────

  await writePlatformProject(cwd, supabaseDir, token, project, options);
}

// ─────────────────────────────────────────────────────────────
// Local init - no auth, no API calls
// ─────────────────────────────────────────────────────────────

function runLocalInit(cwd: string, supabaseDir: string, options: InitOptions): void {
  // Create directories
  const dirs = [
    supabaseDir,
    join(supabaseDir, "migrations"),
    join(supabaseDir, "functions"),
    join(supabaseDir, "types"),
    join(supabaseDir, "schema", "public"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // Write minimal config (no project_id)
  const config: Record<string, unknown> = {
    $schema: "../../../cli/config-schema/config.schema.json",
    schema_management: "declarative",
    config_source: "code",
  };
  writeFileSync(join(supabaseDir, "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(supabaseDir, "migrations", ".gitkeep"), "");
  writeFileSync(join(supabaseDir, "functions", ".gitkeep"), "");

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      mode: "local",
      created: [
        "supabase/config.json",
        "supabase/migrations/",
        "supabase/functions/",
        "supabase/types/",
        "supabase/schema/public/",
      ],
      next: {
        command: "supa init",
        description: "Run again to connect to Supabase Platform when ready",
      },
    }));
  } else {
    console.log();
    console.log(chalk.green("✓") + " Initialized Supabase (local)");
    console.log();
    console.log(`  ${chalk.dim("Created in")} ${chalk.bold("./supabase/")}`);
    console.log(`  ${chalk.dim("📄")} config.json`);
    console.log(`  ${chalk.dim("📁")} schema/public/`);
    console.log(`  ${chalk.dim("📁")} migrations/`);
    console.log(`  ${chalk.dim("📁")} functions/`);
    console.log(`  ${chalk.dim("📁")} types/`);
    console.log();
    console.log(chalk.dim("  Start writing SQL in supabase/schema/"));
    console.log(chalk.dim("  When you're ready to deploy, run supa init again to connect to the platform."));
  }
}

// ─────────────────────────────────────────────────────────────
// Platform project write - shared by interactive and non-interactive flows
// ─────────────────────────────────────────────────────────────

async function writePlatformProject(
  cwd: string,
  supabaseDir: string,
  token: string,
  project: InitResult,
  options: InitOptions,
): Promise<void> {
  const { ref: projectRef, name: projectName, schemaManagement = "declarative", configSource = "code", workflowProfile = "solo" } = project;

  // Fetch project config
  const spinner = !options.json && process.stdin.isTTY ? p.spinner() : null;
  spinner?.start("Fetching project config...");

  const client = createClient(token);
  let anonKey = "";
  const apiUrl = `https://${projectRef}.supabase.co`;
  let apiConfig: ReturnType<typeof buildApiConfigFromRemote> = {};
  let authConfig: ReturnType<typeof buildAuthConfigFromRemote> = {};

  try {
    await new Promise((r) => setTimeout(r, 2000));

    const keys = await client.getProjectApiKeys(projectRef);
    const anonKeyObj = keys.find((k) => k.name === "anon" || k.name === "publishable anon key");
    if (anonKeyObj?.api_key) {
      anonKey = anonKeyObj.api_key;
    }

    const remotePostgrest = await client.getPostgrestConfig(projectRef);
    apiConfig = buildApiConfigFromRemote(remotePostgrest as Record<string, unknown>);

    const remoteAuth = await client.getAuthConfig(projectRef);
    authConfig = buildAuthConfigFromRemote(remoteAuth as Record<string, unknown>);
  } catch {
    // Config might not be available yet
  }

  spinner?.stop("Project config fetched");

  // Close the timeline from the wizard
  if (!options.json && process.stdin.isTTY) {
    console.log(S_BAR);
    console.log(`${chalk.dim("└")}`);
  }

  // Dry run - just show what would happen
  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({
        status: "dry_run",
        project: {
          id: projectRef,
          name: projectName,
        },
        wouldCreate: [
          "supabase/config.json",
          "supabase/migrations/",
          "supabase/functions/",
          "supabase/types/",
          "supabase/schema/public/",
        ],
        wouldWriteEnv: !!project.dbPassword,
      }));
    } else {
      console.log();
      console.log(chalk.yellow("Dry run - no changes made"));
      console.log();
      console.log(`${chalk.dim("Would link to:")} ${projectRef} (${projectName})`);
      console.log();
      console.log(chalk.dim("Would create:"));
      console.log("  supabase/config.json");
      console.log("  supabase/migrations/");
      console.log("  supabase/functions/");
      console.log("  supabase/types/");
      console.log("  supabase/schema/public/");
      if (project.dbPassword) {
        console.log("  .env (with SUPABASE_DB_PASSWORD)");
      }
    }
    return;
  }

  // Create directories
  const dirs = [
    supabaseDir,
    join(supabaseDir, "migrations"),
    join(supabaseDir, "functions"),
    join(supabaseDir, "types"),
    join(supabaseDir, "schema", "public"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // Write DB password to .env if we created a new project
  if (project.dbPassword) {
    const envPath = join(cwd, ".env");
    const envLine = `SUPABASE_DB_PASSWORD=${project.dbPassword}\n`;
    if (existsSync(envPath)) {
      const existingContent = readFileSync(envPath, "utf-8");
      if (!existingContent.includes("SUPABASE_DB_PASSWORD=")) {
        appendFileSync(envPath, envLine);
      }
    } else {
      writeFileSync(envPath, envLine);
    }
  }

  // Write config
  const configContent = buildConfigJson({
    projectId: projectRef,
    workflowProfile,
    schemaManagement,
    configSource,
    api: apiConfig,
    auth: authConfig,
  });
  writeFileSync(join(supabaseDir, "config.json"), configContent);
  writeFileSync(join(supabaseDir, "migrations", ".gitkeep"), "");
  writeFileSync(join(supabaseDir, "functions", ".gitkeep"), "");

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      project: {
        id: projectRef,
        name: projectName,
        dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
      },
      api: {
        url: apiUrl,
        anonKey: anonKey || null,
        secretKey: '[hidden] run "supa project api-keys --json --reveal"',
      },
      usage: `createClient("${apiUrl}", "<ANON_KEY>")`,
      created: [
        "supabase/config.json",
        "supabase/migrations/",
        "supabase/functions/",
        "supabase/types/",
        "supabase/schema/public/",
      ],
      next: {
        command: "supa dev --json",
        description: "Start watcher for continuous sync - runs schema changes automatically",
      },
      customize: {
        config: "supabase/config.json - Edit API and auth settings",
        schema: "supabase/schema/ - Add .sql files to define your database schema",
        migrations: "supabase/migrations/ - Add version-controlled migration files",
      },
    }));
  } else {
    const dashboardUrl = `https://supabase.com/dashboard/project/${projectRef}`;

    console.log();
    console.log(chalk.green("✓") + " Initialized Supabase");
    console.log(`  Created a new project: ${chalk.bold(`"${projectName}"`)}`);
    console.log();
    console.log(chalk.dim("  Project"));
    console.log(`  ${chalk.dim("ID:")} ${projectRef}`);
    console.log(`  ${chalk.dim("Dashboard:")} ${chalk.cyan(dashboardUrl)}`);
    console.log();
    console.log(chalk.dim("  API Credentials"));
    console.log(`  ${chalk.dim("URL:")} ${chalk.cyan(apiUrl)}`);
    console.log(`  ${chalk.dim("Anon Key:")} ${anonKey || chalk.dim("[Keys still initializing]")}`);
    console.log(`  ${chalk.dim("Secret Key:")} ${chalk.dim('[hidden] run "supa project api-keys --reveal"')}`);
    console.log();
    console.log(chalk.dim("  Usage"));
    console.log(`  ${chalk.dim("createClient(")}${chalk.cyan(`"${apiUrl}"`)}${chalk.dim(', "<ANON_KEY>")')}`);
    console.log();
    console.log(`  ${chalk.dim("Created in")} ${chalk.bold("./supabase/")}`);
    console.log(`  ${chalk.dim("📄")} config.json`);
    console.log(`  ${chalk.dim("📁")} migrations/`);
    console.log(`  ${chalk.dim("📁")} functions/`);
    console.log(`  ${chalk.dim("📁")} types/`);
    console.log();
    console.log(chalk.dim("  Customize your project"));
    console.log(`  ${chalk.dim("📄")} supabase/config.json ${chalk.dim("API and auth settings")}`);
    console.log(`  ${chalk.dim("📁")} supabase/schema/ ${chalk.dim("Add .sql files for schema")}`);
    console.log();
    console.log(chalk.dim("  Tip: Use --json for structured output when scripting"));

    // Prompt to run supa dev (skip if --yes)
    if (process.stdin.isTTY && !options.yes) {
      console.log();
      const runDev = await p.confirm({
        message: "Run supa dev now?",
      });

      if (!p.isCancel(runDev) && runDev) {
        console.log();
        console.log(chalk.dim("Starting supa dev..."));
        console.log();

        const spawnEnv = { ...process.env };
        if (project.dbPassword) {
          spawnEnv.SUPABASE_DB_PASSWORD = project.dbPassword;
        }

        const child = spawn("pnpm", ["supa", "dev"], {
          stdio: "inherit",
          cwd: process.cwd(),
          env: spawnEnv,
        });

        await new Promise<void>((resolve) => {
          child.on("close", () => resolve());
        });
      }
    }
  }
}
