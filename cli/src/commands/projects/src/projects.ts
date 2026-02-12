/**
 * Projects command - list or create projects
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient, type Project } from "@/lib/api.js";
import { requireAuth } from "@/lib/config.js";
import { formatProjectStatus, REGIONS, type Region } from "@/lib/constants.js";
import { createProject as createProjectOp } from "@/lib/operations.js";
import { searchSelect } from "@/components/search-select.js";
import { printCommandHeader } from "@/components/command-header.js";
import { printTable } from "@/components/table.js";

interface ProjectsOptions {
  action: "list" | "new" | "delete";
  json?: boolean;
  org?: string;
  region?: string;
  name?: string;
  yes?: boolean;
  dryRun?: boolean;
  projectRef?: string;
}

function printProjectsTable(projects: Project[], orgNames: Map<string, string>) {
  printTable(
    [
      { label: "Name", width: 30, value: (p: Project) => p.name },
      { label: "Org", width: 25, value: (p: Project) => orgNames.get(p.organization_slug) || p.organization_slug },
      { label: "Id", width: 25, value: (p: Project) => p.ref },
      { label: "Status", width: 20, value: (p: Project) => formatProjectStatus(p.status) },
    ],
    projects,
  );
}

async function listProjects(token: string, orgSlug?: string) {
  printCommandHeader({
    command: "supa projects list",
    description: ["List all projects."],
  });

  const spinner = p.spinner();
  spinner.start("Loading projects...");

  try {
    const client = createClient(token);
    const [allProjects, orgs] = await Promise.all([
      client.listProjects(),
      client.listOrganizations(),
    ]);

    let projects = allProjects;
    if (orgSlug) {
      projects = projects.filter((p) => p.organization_slug === orgSlug);
    }

    const orgNames = new Map(orgs.map((o) => [o.slug, o.name]));

    spinner.stop(`Found ${projects.length} project${projects.length === 1 ? "" : "s"}`);

    if (projects.length === 0) {
      console.log(chalk.dim("\nNo projects found."));
      return;
    }

    console.log();
    printProjectsTable(projects, orgNames);
    console.log();
  } catch (error) {
    spinner.stop("Failed to load projects");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

async function selectOrg(client: ReturnType<typeof createClient>, orgSlug?: string): Promise<string> {
  if (orgSlug) return orgSlug;

  const spinner = p.spinner();
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

  return selected;
}

async function createProject(token: string, options: ProjectsOptions) {
  printCommandHeader({
    command: "supa projects new",
    description: ["Create a new project."],
  });

  const client = createClient(token);

  const orgSlug = await selectOrg(client, options.org);

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
  const createSpinnerInstance = p.spinner();
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

  console.log();
}

async function deleteProject(token: string, options: ProjectsOptions) {
  printCommandHeader({
    command: "supa projects delete",
    description: ["Permanently delete a project."],
  });

  const client = createClient(token);

  let ref = options.projectRef;

  // If no ref provided, let the user pick org then project
  if (!ref) {
    const orgSlug = await selectOrg(client, options.org);

    // List projects for that org
    const spinner = p.spinner();
    spinner.start("Loading projects...");
    const allProjects = await client.listProjects();
    const projects = allProjects.filter((proj) => proj.organization_slug === orgSlug);
    spinner.stop(`Found ${projects.length} project${projects.length === 1 ? "" : "s"}`);

    if (projects.length === 0) {
      console.log(chalk.dim("\nNo projects found in this organization."));
      return;
    }

    const selected = await searchSelect({
      message: "Select project to delete",
      items: projects.map((proj) => ({
        value: proj.ref,
        label: proj.name,
        hint: `${proj.ref} · ${proj.region}`,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    ref = selected;
  }

  // Look up project details for confirmation
  const lookupSpinner = p.spinner();
  lookupSpinner.start("Looking up project...");

  let project: Project;
  try {
    project = await client.getProject(ref);
    lookupSpinner.stop(`Project: ${project.name}`);
  } catch (error) {
    lookupSpinner.stop("Project not found");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }

  // Confirm unless --yes
  if (!options.yes) {
    console.log();
    console.log(`  ${chalk.dim("Name:")}   ${project.name}`);
    console.log(`  ${chalk.dim("Ref:")}    ${ref}`);
    console.log(`  ${chalk.dim("Region:")} ${project.region}`);
    console.log();

    const confirmed = await p.confirm({
      message: `Permanently delete ${project.name}? This cannot be undone.`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Deletion cancelled");
      process.exit(0);
    }
  }

  const deleteSpinner = p.spinner();
  deleteSpinner.start(`Deleting project "${project.name}"...`);

  try {
    await client.deleteProject(ref);
    deleteSpinner.stop(chalk.green(`Project deleted: ${project.name}`));
  } catch (error) {
    deleteSpinner.stop("Failed to delete project");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }

  console.log();
}

export async function projectsCommand(options: ProjectsOptions) {
  const token = await requireAuth({ json: options.json });

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

  // JSON mode for delete
  if (options.json && options.action === "delete") {
    try {
      const client = createClient(token);
      await client.deleteProject(options.projectRef!);
      console.log(JSON.stringify({ status: "success", ref: options.projectRef }));
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to delete project",
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

  if (options.action === "delete") {
    await deleteProject(token, options);
  } else if (options.action === "new") {
    await createProject(token, options);
  } else {
    await listProjects(token, options.org);
  }
}
