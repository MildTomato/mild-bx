/**
 * Init command - initialize a new supabase project
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@/lib/api.js";
import { SUPABASE_DASHBOARD_URL, projectUrlFromDbHost } from "@/lib/env.js";
import { requireAuth, loadProjectConfig, getWorkflowProfile } from "@/lib/config.js";
import { getCurrentBranch } from "@/lib/git.js";
import { type Region, REGIONS } from "@/lib/constants.js";
import { createProject as createProjectOp } from "@/lib/operations.js";
import { buildApiConfigFromRemote, buildAuthConfigFromRemote } from "@/lib/sync.js";
import {
  WORKFLOW_PROFILES,
  LEGACY_WORKFLOW_PROFILES,
  DEFAULT_WORKFLOW_PROFILE,
  isLegacyProfile,
  getProfileDefinition,
} from "@/lib/workflow-profiles.js";
import { writeProjectEnv } from "@/lib/env-file.js";
import type { WorkflowProfile, SchemaManagement, ConfigSource } from "@/lib/config-types.js";
import { runInitWizard, type InitResult } from "@/components/InitWizard.js";
import { S_BAR } from "@/components/command-header.js";
import { printKeyValue, printNextSteps, printWarning, printSectionHeader, createSpinner, setOutputMode } from "@/components/output.js";

interface InitOptions {
  yes?: boolean;
  json?: boolean;
  org?: string;
  project?: string;
  newProject?: boolean;
  link?: string;
  name?: string;
  region?: string;
  workflowProfile?: string;
  schemaManagement?: string;
  configSource?: string;
  dryRun?: boolean;
  local?: boolean;
}

interface ConfigData {
  projectId: string;
  workflowProfile: WorkflowProfile;
  schemaManagement: SchemaManagement;
  configSource: ConfigSource;
  productionBranch?: string;
  api?: ReturnType<typeof buildApiConfigFromRemote>;
  auth?: ReturnType<typeof buildAuthConfigFromRemote>;
}

function buildConfigJson(data: ConfigData): string {
  const config: Record<string, unknown> = {
    $schema: "../../../packages/config/config-schema/config.schema.json",
    project_id: data.projectId,
    workflow_profile: data.workflowProfile,
    schema_management: data.schemaManagement,
    config_source: data.configSource,
  };

  if (data.productionBranch) {
    config.production_branch = data.productionBranch;
  }

  if (data.api && Object.keys(data.api).length > 0) {
    config.api = data.api;
  }

  if (data.auth && Object.keys(data.auth).length > 0) {
    config.auth = data.auth;
  }

  return JSON.stringify(config, null, 2);
}

export async function initCommand(options: InitOptions): Promise<void> {
  setOutputMode(options);
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
      const profile = config ? getWorkflowProfile(config) : "remote";
      const dashboardUrl = `${SUPABASE_DASHBOARD_URL}/project/${projectId}`;
      const profileDef = getProfileDefinition(profile);
      const legacy = isLegacyProfile(profile);

      if (options.json) {
        console.log(JSON.stringify({
          status: "already_initialized",
          project_id: projectId,
          workflow_profile: profile,
          legacy_profile: legacy,
          dashboard_url: dashboardUrl,
          config_path: join(supabaseDir, "config.json"),
        }));
      } else {
        console.log();
        console.log("Already initialized in this directory.");
        console.log();
        printKeyValue("Project", projectId)
        printKeyValue("Config", "supabase/config.json")
        printKeyValue(
          "Profile",
          `${profile}${legacy ? chalk.yellow(" (legacy)") : ""}`,
          profileDef?.description,
        )
        if (legacy) {
          console.log();
          printWarning(
            "Your workflow profile is out of date.",
            "supa project profile",
            "to switch to a current profile",
          )
        }
        console.log();
        printNextSteps([
          { command: "supa dev",             description: "Start development watcher" },
          { command: "supa project profile", description: "Change workflow profile" },
          { command: "supa status",          description: "Show project status" },
        ])
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

  // Validate mutual exclusion of --new and --link
  if (options.newProject && options.link) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "--new and --link are mutually exclusive" }));
    } else {
      console.error("Error: --new and --link are mutually exclusive");
    }
    process.exit(1);
  }

  // --link is an alias for --project
  if (options.link && !options.project) {
    options.project = options.link;
  }

  if (options.newProject && (!options.org || !options.name || !options.region)) {
    if (options.json) {
      console.log(JSON.stringify({
        status: "error",
        message: "--new requires --org, --name, and --region",
        example: "supa init --new --org my-org --name my-project --region us-east-1",
      }));
    } else {
      console.error("Error: --new requires --org, --name, and --region");
      console.error("Example: supa init --new --org my-org --name my-project --region us-east-1");
    }
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────
  // Non-interactive: platform flags (--project, --org/--name/--region)
  // ─────────────────────────────────────────────────────────────

  const token = await requireAuth({ json: options.json });

  // Validate --workflow-profile if supplied
  if (options.workflowProfile !== undefined) {
    const validProfiles: string[] = ["remote", "local", "branching-remote", "branching-local"];
    if (!validProfiles.includes(options.workflowProfile)) {
      if (options.json) {
        console.log(JSON.stringify({ status: "error", message: `Invalid --workflow-profile: "${options.workflowProfile}". Valid values: ${validProfiles.join(", ")}` }));
      } else {
        console.error(`Error: Invalid --workflow-profile: "${options.workflowProfile}"`);
        console.error(`Valid values: ${validProfiles.join(", ")}`);
      }
      process.exit(1);
    }
  }

  let project: InitResult;

  // Non-interactive mode: use flags if provided
  if (options.project) {
    // Refuse to overwrite an existing initialised project
    if (existsSync(join(supabaseDir, "config.json"))) {
      const existing = loadProjectConfig(cwd);
      if (existing?.project_id) {
        if (options.json) {
          console.log(JSON.stringify({ status: "error", message: `Already initialised with project ${existing.project_id}. Remove supabase/config.json to re-initialise.` }));
        } else {
          console.error(`Error: Already initialised with project ${existing.project_id}.`);
          console.error("Remove supabase/config.json to re-initialise.");
        }
        process.exit(1);
      }
    }
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
      project = { ref: found.ref, name: found.name, schemaManagement: (options.schemaManagement as SchemaManagement) ?? "declarative", configSource: (options.configSource as ConfigSource) ?? "code", workflowProfile: (options.workflowProfile as WorkflowProfile) ?? DEFAULT_WORKFLOW_PROFILE };
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
      project = { ref: newProject.ref, name: options.name, schemaManagement: (options.schemaManagement as SchemaManagement) ?? "declarative", configSource: (options.configSource as ConfigSource) ?? "code", workflowProfile: (options.workflowProfile as WorkflowProfile) ?? DEFAULT_WORKFLOW_PROFILE, dbPassword };
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
        action_required: "choose",
        message: "Do you want to create a new project or link an existing one?",
        options: ["create_new", "link_existing"],
        create_new: "supa init --new --org <slug> --name <name> --region <region>",
        link_existing: "supa init --link <ref>",
        hint: 'Run "supa orgs --json" to list your organizations and get your org slug.',
      }));
    } else {
      console.error("Error: Non-interactive mode requires flags.");
      console.error("To create a new project: supa init --new --org <slug> --name <name> --region <region>");
      console.error("To link an existing project: supa init --link <ref>");
      console.error('Run "supa orgs --json" to list your organizations and get your org slug.');
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
    $schema: "../../../packages/config/config-schema/config.schema.json",
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
    printKeyValue("Created in", chalk.bold("./supabase/"))
    console.log(`  ${chalk.dim("📄")} config.json`);
    console.log(`  ${chalk.dim("📁")} schema/public/`);
    console.log(`  ${chalk.dim("📁")} migrations/`);
    console.log(`  ${chalk.dim("📁")} functions/`);
    console.log(`  ${chalk.dim("📁")} types/`);
    console.log();
    printNextSteps([
      { command: "supa init", description: "Connect to Supabase Platform when ready" },
    ])
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
  const { ref: projectRef, name: projectName, schemaManagement = "declarative", configSource = "code", workflowProfile = DEFAULT_WORKFLOW_PROFILE } = project;

  // Fetch project config
  const spinner = createSpinner();
  spinner.start("Fetching project config...");

  const client = createClient(token);
  let anonKey = "";
  let apiUrl = "";
  let apiConfig: ReturnType<typeof buildApiConfigFromRemote> = {};
  let authConfig: ReturnType<typeof buildAuthConfigFromRemote> = {};

  try {
    await new Promise((r) => setTimeout(r, 2000));

    const projectData = await client.getProject(projectRef);
    apiUrl = projectUrlFromDbHost(projectData.database.host, projectRef);

    const keys = await client.getProjectApiKeys(projectRef);
    const anonKeyObj = keys.find((k) => k.name === "anon" || k.name === "publishable anon key");
    if (anonKeyObj?.api_key) {
      anonKey = anonKeyObj.api_key;
    }

    const remotePostgrest = await client.getPostgrestConfig(projectRef);
    apiConfig = buildApiConfigFromRemote(remotePostgrest as Record<string, unknown>);

    const remoteAuth = await client.getAuthConfig(projectRef);
    authConfig = buildAuthConfigFromRemote(remoteAuth as Record<string, unknown>);
  } catch (error) {
    // The project may still be provisioning — config and API keys are not always
    // available immediately after creation. This is non-fatal; supa init writes
    // the config with defaults and the user can run `supa project pull` later.
    if (options.verbose) {
      console.error(`[init] Could not fetch project config (project may still be provisioning): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  spinner.stop("Project config fetched");

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
        console.log("  .env.local (with SUPABASE_DB_PASSWORD)");
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

  // Inject DB password into process.env so writeProjectEnv writes it to .env.local
  if (project.dbPassword) {
    process.env.SUPABASE_DB_PASSWORD = project.dbPassword;
  }

  // Detect the current git branch to record as the production branch.
  // This tells supa dev which git branch maps to the main project (not a preview).
  const detectedProductionBranch = getCurrentBranch(cwd) ?? undefined;

  // Write config
  const configContent = buildConfigJson({
    projectId: projectRef,
    workflowProfile,
    schemaManagement,
    configSource,
    productionBranch: detectedProductionBranch,
    api: apiConfig,
    auth: authConfig,
  });
  writeFileSync(join(supabaseDir, "config.json"), configContent);
  writeFileSync(join(supabaseDir, "migrations", ".gitkeep"), "");
  writeFileSync(join(supabaseDir, "functions", ".gitkeep"), "");

  // Write fresh credentials to .env.local so the project is immediately usable
  await writeProjectEnv({ cwd, projectRef, token });

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      project: {
        id: projectRef,
        name: projectName,
        dashboardUrl: `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`,
      },
      api: {
        url: apiUrl,
        anonKey: anonKey || null,
        secretKey: '[hidden] run "supa project api-keys --json --reveal"',
      },
      usage: `createClient("${apiUrl}", "<ANON_KEY>")`,
      schema_management: schemaManagement,
      workflow_profile: workflowProfile,
      created: [
        "supabase/config.json",
        "supabase/schema/public/",
        "supabase/migrations/",
        "supabase/functions/",
        "supabase/types/",
      ],
      schema: schemaManagement === "declarative"
        ? { mode: "declarative", add_tables: "supabase/schema/public/<table>.sql", hint: "Add .sql files to supabase/schema/ — do NOT use supabase/migrations/ for schema changes" }
        : { mode: "migrations", add_migrations: "supabase/migrations/<timestamp>_<name>.sql" },
      next: {
        command: "supa dev",
        long_running: true,
        agent_instruction: "Run in a background shell and continue — do not wait for it to complete.",
      },
    }));
  } else {
    const dashboardUrl = `${SUPABASE_DASHBOARD_URL}/project/${projectRef}`;

    console.log();
    console.log(chalk.green("✓") + " Initialized Supabase");
    console.log(`  Created a new project: ${chalk.bold(`"${projectName}"`)}`);
    console.log();
    printSectionHeader("Project")
    printKeyValue("ID", projectRef)
    printKeyValue("Dashboard", chalk.cyan(dashboardUrl))
    console.log();
    printSectionHeader("API Credentials")
    printKeyValue("URL", chalk.cyan(apiUrl))
    printKeyValue("Anon Key", anonKey || chalk.dim("[Keys still initializing]"))
    printKeyValue("Secret Key", chalk.dim('[hidden] run "supa project api-keys --reveal"'))
    console.log();
    printSectionHeader("Usage")
    console.log(`  ${chalk.dim("createClient(")}${chalk.cyan(`"${apiUrl}"`)}${chalk.dim(', "<ANON_KEY>")')}`);
    console.log();
    printKeyValue("Created in", chalk.bold("./supabase/"))
    console.log(`  ${chalk.dim("📄")} config.json`);
    if (schemaManagement === "declarative") {
      console.log(`  ${chalk.dim("📁")} schema/public/  ${chalk.dim("← add .sql files here")}`);
    }
    console.log(`  ${chalk.dim("📁")} migrations/`);
    console.log(`  ${chalk.dim("📁")} functions/`);
    console.log(`  ${chalk.dim("📁")} types/`);
    console.log();
    printNextSteps([
      { command: "supa dev", description: "Start development watcher" },
    ])
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
