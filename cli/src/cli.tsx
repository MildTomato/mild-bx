import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { initCommand } from "./commands/init.js";
import { orgsCommand } from "./commands/orgs.js";
import { projectsCommand } from "./commands/projects.js";
import { pullCommand } from "./commands/pull.js";
import { pushCommand } from "./commands/push.js";
import { devCommand } from "./commands/dev.js";
import { seedCommand, seedStatusCommand } from "./commands/seed.js";
import { apiKeysCommand } from "./commands/api-keys.js";
import { profileCommand } from "./commands/profile.js";
import { extractCLISpec } from "./lib/cli-spec.js";
import {
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
} from "./lib/config.js";
import { getCurrentBranch } from "./lib/git.js";
import { C } from "./lib/colors.js";

// Command descriptions
const DEV_COMMAND_DESCRIPTION =
  "Watcher that auto syncs changes to hosted environment [long-running]";

// Load .env files silently (simple implementation to avoid dotenv noise)
function loadEnvFile(path: string) {
  try {
    if (!existsSync(path)) return;
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

loadEnvFile(".env");
loadEnvFile("supabase/.env");
loadEnvFile(".env.local");

// Get current project context for display
function getProjectContext(): string {
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);

  if (!config) {
    return `${C.secondary}No project configured${C.reset}`;
  }

  const branch = getCurrentBranch(cwd) || "unknown";
  const profile = getProfileOrAuto(config, undefined, branch);
  const projectRef = getProjectRef(config, profile);

  const lines = [];
  if (projectRef) {
    lines.push(
      `${C.secondary}Project:${C.reset} ${C.value}${projectRef}${C.reset}`,
    );
  }
  lines.push(
    `${C.secondary}Git Branch:${C.reset}  ${C.fileName}${branch}${C.reset}`,
  );
  if (profile?.name) {
    lines.push(
      `${C.secondary}Profile:${C.reset} ${C.value}${profile.name}${C.reset}`,
    );
  }

  return lines.join("\n");
}

// Helper to configure consistent help text for all commands
function configureHelp(cmd: Command): Command {
  return cmd
    .addHelpText("before", () => `\n${getProjectContext()}\n`)
    .addHelpText("after", "\n");
}

const program = new Command();

program
  .name("supa")
  .description("Supabase DX CLI - experimental developer experience tools")
  .version("0.0.1")
  .addHelpText("before", () => {
    return `\n${getProjectContext()}\n`;
  })
  .addHelpText(
    "after",
    `
${C.secondary}Tip for AI agents:${C.reset} Most commands support ${C.value}--json${C.reset} for machine-readable output.
`,
  )
  .action(() => {
    // Show help when no command is given
    program.help();
  })
  .hook("preAction", (thisCommand) => {
    // Skip auth check for init, help, and root command
    const skipAuthCommands = ["init", "help", "supa"];
    if (skipAuthCommands.includes(thisCommand.name())) return;

    // Skip auth check if showing help
    if (process.argv.includes("--help") || process.argv.includes("-h")) return;

    if (!process.env.SUPABASE_ACCESS_TOKEN) {
      console.error(
        "Error: SUPABASE_ACCESS_TOKEN environment variable is required",
      );
      console.error(
        "Get one at: https://supabase.com/dashboard/account/tokens",
      );
      process.exit(1);
    }
  })
  .hook("postAction", (thisCommand) => {
    // In non-TTY environments, suggest --json if not already using it
    if (!process.stdout.isTTY && !process.argv.includes("--json")) {
      // Skip for commands that don't support --json
      const commandOptions = thisCommand.options.map((o) => o.long);
      if (commandOptions.includes("--json")) {
        console.error();
        console.error(
          `${C.secondary}Tip: Use --json for structured output when scripting${C.reset}`,
        );
      }
    }
  });

// Init command
configureHelp(
  program
    .command("init")
    .description("Initialize a new supabase project")
    .option("-y, --yes", "Skip prompts and use defaults")
    .option("--org <slug>", "Organization slug")
    .option("--project <ref>", "Link to existing project by ref")
    .option(
      "--name <name>",
      "Name for new project (requires --org and --region)",
    )
    .option("--region <region>", "Region for new project (e.g., us-east-1)")
    .option("--json", "Output as JSON")
    .action(initCommand),
);

// Organizations command
configureHelp(
  program
    .command("orgs")
    .description("List organizations")
    .option("--json", "Output as JSON")
    .action(orgsCommand),
);

// Projects command group
const projects = configureHelp(
  program
    .command("projects")
    .description("Manage projects")
    .action(() => projects.help()),
);

configureHelp(
  projects
    .command("list")
    .description("List all projects")
    .option("--json", "Output as JSON")
    .option("--org <id>", "Filter by organization ID")
    .action((options) => projectsCommand({ ...options, action: "list" })),
);

configureHelp(
  projects
    .command("new")
    .description("Create a new project")
    .option("--org <id>", "Organization ID")
    .option("--region <region>", "Region (e.g., us-east-1)")
    .option("--name <name>", "Project name")
    .option("-y, --yes", "Skip confirmation prompts")
    .action((options) => projectsCommand({ ...options, action: "new" })),
);

// Dev command - top-level shortcut
configureHelp(
  program
    .command("dev")
    .description(DEV_COMMAND_DESCRIPTION)
    .option("-p, --profile <name>", "Profile to use")
    .option(
      "--debounce <ms>",
      "Debounce interval for file changes (e.g., 500ms, 1s)",
      "500ms",
    )
    .option(
      "--types-interval <interval>",
      "Interval for regenerating types (e.g., 30s, 1m)",
      "30s",
    )
    .option("--no-branch-watch", "Disable git branch watching")
    .option(
      "--seed",
      "Run seed files after schema sync (also re-seeds on schema changes)",
    )
    .option("--no-seed", "Disable seeding even if enabled in config")
    .option("--dry-run", "Show what would be synced without applying")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .option("--json", "Output as JSON (events as newline-delimited JSON)")
    .action(devCommand),
);

// Project command group - project operations
const project = configureHelp(
  program
    .command("project")
    .description("Project operations")
    .allowUnknownOption(true)
    .action(() => {
      // Check for common mistakes and suggest corrections
      const rawArgs = process.argv.slice(process.argv.indexOf("project") + 1);

      if (rawArgs.includes("--set")) {
        const setIdx = rawArgs.indexOf("--set");
        const setValue = rawArgs[setIdx + 1] || "<profile>";
        console.error(`Did you mean: supa project profile --set ${setValue}`);
        process.exit(1);
      }

      project.help();
    }),
);

configureHelp(
  project
    .command("pull")
    .description("Pull remote state to local (remote → local)")
    .option("-p, --profile <name>", "Profile to use")
    .option("--plan", "Show what would happen without making changes")
    .option("--types-only", "Only generate TypeScript types")
    .option(
      "--schemas <schemas>",
      "Schemas to include for type generation",
      "public",
    )
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .action(pullCommand),
);

configureHelp(
  project
    .command("push")
    .description("Push local changes to remote (local → remote)")
    .option("-p, --profile <name>", "Profile to use")
    .option("--plan", "Show what would happen without making changes")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--migrations-only", "Only apply migrations")
    .option("--config-only", "Only apply config changes (api, auth settings)")
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .action(pushCommand),
);

configureHelp(
  project
    .command("dev")
    .description(DEV_COMMAND_DESCRIPTION)
    .option("-p, --profile <name>", "Profile to use")
    .option(
      "--debounce <ms>",
      "Debounce interval for file changes (e.g., 500ms, 1s)",
      "500ms",
    )
    .option(
      "--types-interval <interval>",
      "Interval for regenerating types (e.g., 30s, 1m)",
      "30s",
    )
    .option("--no-branch-watch", "Disable git branch watching")
    .option(
      "--seed",
      "Run seed files after schema sync (also re-seeds on schema changes)",
    )
    .option("--no-seed", "Disable seeding even if enabled in config")
    .option("--dry-run", "Show what would be synced without applying")
    .option("-v, --verbose", "Show detailed pg-delta logging")
    .option("--json", "Output as JSON (events as newline-delimited JSON)")
    .action(devCommand),
);

configureHelp(
  project
    .command("seed")
    .description("Run seed files against the database")
    .option("-p, --profile <name>", "Profile to use")
    .option("--dry-run", "Show what would be seeded without applying")
    .option("-v, --verbose", "Show detailed logging")
    .option("--json", "Output as JSON")
    .action(seedCommand),
);

configureHelp(
  project
    .command("seed-status")
    .description("Show seed configuration and files")
    .option("--json", "Output as JSON")
    .action(seedStatusCommand),
);

configureHelp(
  project
    .command("api-keys")
    .description("List API keys for the project")
    .option("-p, --profile <name>", "Profile to use")
    .option("--reveal", "Show full API keys (not masked)")
    .option("--json", "Output as JSON")
    .action(apiKeysCommand),
);

configureHelp(
  project
    .command("profile")
    .description("View or change workflow profile")
    .option("--set <profile>", "Set workflow profile (solo, staged, preview, preview-git)")
    .option("--json", "Output as JSON")
    .action(profileCommand),
);

program.parse();
