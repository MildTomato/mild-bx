/**
 * Bootstrap command - download a starter template into the working directory
 *
 * Flow:
 *   1. Pick template (interactive or by name)
 *   2. Download into working directory
 *   3. If there's an existing linked project with a remote profile:
 *      push migrations and write .env
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { createClient } from "@/lib/api.js";
import { getAccessTokenAsync } from "@/lib/config.js";
import {
  loadProjectConfig,
  getProjectId,
  getWorkflowProfile,
} from "@/lib/config.js";
import { printCommandHeader } from "@/components/command-header.js";
import { cancelSymbol } from "@/components/search-select.js";
import {
  fetchTemplates,
  downloadTemplate,
  pickTemplate,
  type StarterTemplate,
} from "@/lib/templates.js";
import { writeSmartEnv, resolveProjectEnv } from "@/lib/dotenv.js";
import { waitForProjectReady } from "@/lib/project-health.js";
import { pushMigrations } from "@/lib/migrations.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface BootstrapOptions {
  template?: string;
  yes?: boolean;
  json?: boolean;
  dryRun?: boolean;
  workdir?: string;
  password?: string;
}

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value) || value === cancelSymbol;
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

export async function bootstrapHandler(
  options: BootstrapOptions,
): Promise<void> {
  const isInteractive = !options.json && process.stdin.isTTY;

  // 0. Resolve working directory
  const workdir = options.workdir
    ? resolve(options.workdir)
    : process.cwd();

  if (!existsSync(workdir)) {
    mkdirSync(workdir, { recursive: true });
  }

  // Show header for interactive mode
  if (isInteractive) {
    printCommandHeader({
      command: "supa bootstrap",
      description: ["Download a starter template into this directory."],
    });
  }

  // Check if directory is non-empty
  if (isInteractive && readdirSync(workdir).length > 0) {
    const overwrite = await p.confirm({
      message: `Directory ${chalk.bold(workdir)} is not empty. Overwrite existing files?`,
    });
    if (isCancel(overwrite) || !overwrite) {
      p.cancel("Cancelled");
      return;
    }
  }

  // 1. Template selection
  let selectedTemplate: StarterTemplate | null = null;
  let alreadyDownloaded = false;

  if (options.template || !isInteractive) {
    // Non-interactive paths need to fetch templates directly
    const spinner = isInteractive ? p.spinner() : null;
    spinner?.start("Fetching templates...");
    let templates: StarterTemplate[];
    try {
      templates = await fetchTemplates();
    } catch (err) {
      spinner?.stop(chalk.red("Failed to fetch templates"));
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to fetch templates",
          }),
        );
      } else {
        console.error(
          "Error:",
          err instanceof Error ? err.message : "Failed to fetch templates",
        );
      }
      process.exit(1);
    }
    spinner?.stop(`Found ${templates.length} template${templates.length === 1 ? "" : "s"}`);

    if (options.template) {
      // Named template from CLI arg
      const found = templates.find(
        (t) => t.name.toLowerCase() === options.template!.toLowerCase(),
      );
      if (!found) {
        if (options.json) {
          console.log(
            JSON.stringify({
              status: "error",
              message: `Template not found: ${options.template}`,
              available: templates.map((t) => t.name),
            }),
          );
        } else {
          console.error(`Error: Template not found: ${options.template}`);
          console.error(
            `Available templates: ${templates.map((t) => t.name).join(", ")}`,
          );
        }
        process.exit(1);
      } else {
        selectedTemplate = found;
      }
    } else {
      // Non-interactive without template name — list templates as JSON
      if (options.json) {
        console.log(
          JSON.stringify({
            templates: templates.map((t) => ({
              name: t.name,
              description: t.description,
              url: t.url,
              start: t.start,
            })),
          }),
        );
        return;
      }
      console.error(
        "Error: Template name is required in non-interactive mode.",
      );
      console.error('Run "supa bootstrap --json" to list available templates.');
      process.exit(1);
    }
  } else {
    // Interactive — use shared picker (handles confirm, fetch, search, download)
    const picked = await pickTemplate(workdir);
    if (picked) {
      selectedTemplate = picked;
      // pickTemplate already downloaded the template
      alreadyDownloaded = true;
    }
  }

  // Dry run: show what would happen
  if (options.dryRun) {
    const config = loadProjectConfig(workdir);
    const projectRef = config ? getProjectId(config) : undefined;
    const profile = config ? getWorkflowProfile(config) : undefined;
    const isRemote = projectRef && profile !== "solo";

    if (options.json) {
      console.log(
        JSON.stringify({
          status: "dry_run",
          template: selectedTemplate
            ? { name: selectedTemplate.name, url: selectedTemplate.url }
            : null,
          workdir,
          wouldDownload: !!selectedTemplate,
          linkedProject: projectRef || null,
          wouldPushMigrations: !!isRemote,
          wouldWriteEnv: !!isRemote,
        }),
      );
    } else {
      console.log();
      console.log(chalk.yellow("Dry run - no changes made"));
      console.log();
      console.log(`${chalk.dim("Template:")} ${selectedTemplate ? selectedTemplate.name : "none"}`);
      console.log(`${chalk.dim("Directory:")} ${workdir}`);
      if (projectRef) {
        console.log(`${chalk.dim("Project:")} ${projectRef} (${profile})`);
      }
      console.log();
      console.log(chalk.dim("Would:"));
      if (selectedTemplate) {
        console.log(`  - Download template from GitHub`);
      } else {
        console.log(`  - Create empty project scaffold`);
      }
      if (isRemote) {
        console.log(`  - Push migrations to ${projectRef}`);
        console.log(`  - Write .env with project credentials`);
      }
    }
    return;
  }

  // 2. Download template (skip if pickTemplate already handled it, or no template chosen)
  if (selectedTemplate && !alreadyDownloaded) {
    const dlSpinner = isInteractive ? p.spinner() : null;
    dlSpinner?.start(`Downloading "${selectedTemplate.name}" template...`);

    try {
      await downloadTemplate(selectedTemplate, workdir);
      dlSpinner?.stop(`Downloaded "${selectedTemplate.name}" template`);
    } catch (err) {
      dlSpinner?.stop(chalk.red("Download failed"));
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to download template",
          }),
        );
      } else {
        console.error(
          "Error:",
          err instanceof Error ? err.message : "Failed to download template",
        );
      }
      process.exit(1);
    }
  } else if (!selectedTemplate) {
    // No template — create empty project scaffold
    createScratchProject(workdir);
    if (isInteractive) {
      p.log.info("Created empty project scaffold");
    }
  }

  // 3. Check for existing project context
  const config = loadProjectConfig(workdir);
  const projectRef = config ? getProjectId(config) : undefined;
  const profile = config ? getWorkflowProfile(config) : undefined;

  // If no linked project, we're done — just the template files
  if (!projectRef) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "success",
          template: selectedTemplate
            ? { name: selectedTemplate.name, url: selectedTemplate.url }
            : null,
          project: null,
          startCommand: selectedTemplate?.start || null,
        }),
      );
    } else {
      showStartSuggestion(workdir, selectedTemplate);
      if (isInteractive) {
        console.log(chalk.dim("No linked project. Run supa init to connect to Supabase."));
      }
    }
    return;
  }

  // Local profile — no remote operations needed
  if (profile === "solo") {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "success",
          template: selectedTemplate
            ? { name: selectedTemplate.name, url: selectedTemplate.url }
            : null,
          project: { ref: projectRef },
          profile,
          startCommand: selectedTemplate?.start || null,
        }),
      );
    } else {
      showStartSuggestion(workdir, selectedTemplate);
    }
    return;
  }

  // 4. Remote profile — push migrations + write .env
  const token = await getAccessTokenAsync();
  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "Not logged in. Run supa login to push migrations.",
        }),
      );
    } else {
      console.error("Not logged in. Run supa login to push migrations to remote.");
    }
    process.exit(1);
  }

  const client = createClient(token);

  // Wait for project to be healthy
  const waitSpinner = isInteractive ? p.spinner() : null;
  waitSpinner?.start("Waiting for project to be ready...");
  try {
    await waitForProjectReady(client, projectRef, {
      onProgress: (msg) => waitSpinner?.message(msg),
    });
    waitSpinner?.stop("Project is ready");
  } catch (err) {
    waitSpinner?.stop(chalk.red("Project not ready"));
    if (options.json) {
      console.log(JSON.stringify({
        status: "error",
        message: err instanceof Error ? err.message : "Project not ready",
      }));
    } else {
      console.error(err instanceof Error ? err.message : "Project not ready");
    }
    process.exit(1);
  }

  // Push migrations
  const migrationsDir = join(workdir, "supabase", "migrations");
  const migSpinner = isInteractive ? p.spinner() : null;

  if (existsSync(migrationsDir)) {
    const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

    if (sqlFiles.length > 0) {
      migSpinner?.start(`Pushing ${sqlFiles.length} migration(s)...`);

      const migResult = await pushMigrations(client, projectRef, migrationsDir, {
        onProgress: (msg) => migSpinner?.message(msg),
      });

      if (migResult.applied > 0) {
        migSpinner?.stop(`Pushed ${migResult.applied} migration(s)`);
      } else {
        migSpinner?.stop(chalk.yellow("No migrations applied"));
      }

      // Show warnings for failed migrations after spinner stops
      if (isInteractive && migResult.errors.length > 0) {
        for (const err of migResult.errors) {
          p.log.warn(chalk.yellow(`Migration ${err.file} failed: ${err.error}`));
        }
      }
    }
  }

  // Resolve credentials and write .env
  const envCtx = await resolveProjectEnv(client, projectRef, options.password);
  const envKeys = writeSmartEnv(workdir, envCtx);

  // Final output
  if (options.json) {
    console.log(
      JSON.stringify({
        status: "success",
        template: selectedTemplate
          ? { name: selectedTemplate.name, url: selectedTemplate.url }
          : null,
        project: { ref: projectRef },
        profile,
        api: { url: envCtx.supabaseUrl, anonKey: envCtx.anonKey },
        env: { path: ".env", keys: envKeys },
        migrations: 0,
        startCommand: selectedTemplate?.start || null,
      }),
    );
  } else {
    if (isInteractive) {
      p.log.info(`Created .env with ${envKeys.length} key(s)`);
    }
    showStartSuggestion(workdir, selectedTemplate);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function showStartSuggestion(
  workdir: string,
  template: StarterTemplate | null,
): void {
  p.log.success(chalk.green("Done!"));

  if (template?.start) {
    console.log();
    console.log(chalk.dim("To start your app:"));
    if (workdir !== process.cwd()) {
      console.log(chalk.cyan(`cd ${basename(workdir)}`));
    }
    console.log(chalk.cyan(template.start));
  }

  console.log();
}

/**
 * Create an empty project scaffold (supabase/ directory structure)
 */
function createScratchProject(workdir: string): void {
  const supabaseDir = join(workdir, "supabase");
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

  const config: Record<string, unknown> = {
    $schema: "../../../cli/config-schema/config.schema.json",
    schema_management: "declarative",
    config_source: "code",
  };
  writeFileSync(join(supabaseDir, "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(supabaseDir, "migrations", ".gitkeep"), "");
  writeFileSync(join(supabaseDir, "functions", ".gitkeep"), "");
}
