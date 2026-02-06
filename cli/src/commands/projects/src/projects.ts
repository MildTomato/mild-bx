/**
 * Projects command - list or create projects
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient, type Project } from "@/lib/api.js";
import { getAccessToken } from "@/lib/config.js";
import { formatProjectStatus, REGIONS, type Region } from "@/lib/constants.js";
import { createProject as createProjectOp } from "@/lib/operations.js";
import { searchSelect } from "@/components/search-select.js";
import { createSpinner } from "@/lib/spinner.js";

interface ProjectsOptions {
  action: "list" | "new";
  json?: boolean;
  org?: string;
  region?: string;
  name?: string;
  yes?: boolean;
  dryRun?: boolean;
}

function printTable(projects: Project[]) {
  // Column widths
  const nameW = 30;
  const refW = 25;
  const regionW = 15;
  const statusW = 15;

  // Header
  console.log(
    chalk.bold.cyan("Name".padEnd(nameW)) +
    chalk.bold.cyan("Ref".padEnd(refW)) +
    chalk.bold.cyan("Region".padEnd(regionW)) +
    chalk.bold.cyan("Status".padEnd(statusW))
  );
  console.log(chalk.dim("─".repeat(nameW + refW + regionW + statusW)));

  // Rows
  for (const proj of projects) {
    console.log(
      proj.name.slice(0, nameW - 1).padEnd(nameW) +
      proj.ref.padEnd(refW) +
      proj.region.padEnd(regionW) +
      formatProjectStatus(proj.status).padEnd(statusW)
    );
  }
}

async function listProjects(token: string, orgSlug?: string) {
  const spinner = createSpinner();
  spinner.start("Loading projects...");

  try {
    const client = createClient(token);
    let projects = await client.listProjects();

    if (orgSlug) {
      projects = projects.filter((p) => p.organization_slug === orgSlug);
    }

    spinner.stop(`Found ${projects.length} project${projects.length === 1 ? "" : "s"}`);

    if (projects.length === 0) {
      console.log(chalk.dim("\nNo projects found."));
      return;
    }

    console.log();
    printTable(projects);
  } catch (error) {
    spinner.stop("Failed to load projects");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

async function createProject(token: string, options: ProjectsOptions) {
  const client = createClient(token);

  // Get org
  let orgSlug = options.org;
  if (!orgSlug) {
    const spinner = createSpinner();
    spinner.start("Fetching organizations...");
    const orgs = await client.listOrganizations();
    spinner.stop(`Found ${orgs.length} organization${orgs.length === 1 ? "" : "s"}`);

    if (orgs.length === 0) {
      console.error(chalk.red("No organizations found. Create one at supabase.com first."));
      process.exit(1);
    }

    const selected = await searchSelect({
      message: "Select organization",
      items: orgs.map((o) => ({ value: o.slug, label: o.name, hint: o.slug })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    orgSlug = selected;
  }

  // Get name
  let projectName = options.name;
  if (!projectName) {
    const defaultName = `my-project-${Date.now().toString(36).slice(-4)}`;
    const name = await p.text({
      message: "Project name",
      placeholder: defaultName,
      defaultValue: defaultName,
    });

    if (p.isCancel(name)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    projectName = name;
  }

  // Get region
  let region = options.region as Region | undefined;
  if (!region) {
    const selected = await searchSelect({
      message: "Region",
      items: REGIONS.map((r) => ({ value: r.value, label: r.label, hint: r.value })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    region = selected as Region;
  }

  // Dry run - just show what would happen
  if (options.dryRun) {
    console.log();
    console.log(chalk.yellow("Dry run - no changes made"));
    console.log();
    console.log(chalk.dim("Would create project:"));
    console.log(`  ${chalk.dim("Name:")} ${projectName}`);
    console.log(`  ${chalk.dim("Organization:")} ${orgSlug}`);
    console.log(`  ${chalk.dim("Region:")} ${region}`);
    return;
  }

  // Create
  const createSpinnerInstance = createSpinner();
  createSpinnerInstance.start(`Creating project "${projectName}"...`);

  try {
    const result = await createProjectOp({
      token,
      orgSlug,
      region,
      name: projectName,
    });

    createSpinnerInstance.stop(chalk.green(`Project created: ${result.project.name}`));
    console.log(`  ${chalk.dim("Ref:")} ${result.project.ref}`);
    console.log(`  ${chalk.dim("Region:")} ${result.project.region}`);

    if (result.dbPassword) {
      console.log(`  ${chalk.dim("DB Password:")} ${result.dbPassword}`);
      console.log(chalk.yellow("\n  Save this password - it won't be shown again!"));
    }
  } catch (error) {
    createSpinnerInstance.stop("Failed to create project");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

export async function projectsCommand(options: ProjectsOptions) {
  const token = getAccessToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Not logged in" }));
    } else {
      console.error("Not logged in. Set SUPABASE_ACCESS_TOKEN environment variable.");
    }
    process.exitCode = 1;
    return;
  }

  // JSON mode for list
  if (options.json && options.action === "list") {
    try {
      const client = createClient(token);
      let projects = await client.listProjects();

      if (options.org) {
        projects = projects.filter((p) => p.organization_slug === options.org);
      }

      console.log(JSON.stringify({ status: "success", projects }));
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load projects",
        })
      );
    }
    return;
  }

  // Non-TTY check for interactive modes
  if (!options.json && !process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output.");
    process.exit(1);
  }

  if (options.action === "new") {
    await createProject(token, options);
  } else {
    await listProjects(token, options.org);
  }
}
