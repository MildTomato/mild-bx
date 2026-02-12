/**
 * Init Wizard - using Clack prompts + search select
 * Collects all choices first, creates resources at the end
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient, type Organization, type Project } from "../lib/api.js";
import { getAccessTokenAsync } from "../lib/config.js";
import { createProject as createProjectOp, createOrganization as createOrgOp } from "../lib/operations.js";
import { REGIONS, type Region } from "../lib/constants.js";
import { WORKFLOW_PROFILES } from "../lib/workflow-profiles.js";
import type { WorkflowProfile, SchemaManagement, ConfigSource } from "../lib/config-types.js";
import { searchSelect, cancelSymbol } from "./search-select.js";
import { profileSelect } from "./profile-select.js";
import { printCommandHeader, S_BAR } from "./command-header.js";
import { pickTemplate } from "../lib/templates.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface InitResult {
  ref: string;
  name: string;
  schemaManagement: SchemaManagement;
  configSource: ConfigSource;
  workflowProfile: WorkflowProfile;
  dbPassword?: string;
}

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value) || value === cancelSymbol;
}

// ─────────────────────────────────────────────────────────────
// Main Wizard
// ─────────────────────────────────────────────────────────────

export async function runInitWizard(): Promise<InitResult> {
  const token = await getAccessTokenAsync();
  if (!token) {
    throw new Error("Not authenticated. Run `supa login` or set SUPABASE_ACCESS_TOKEN.");
  }

  const client = createClient(token);

  // ─────────────────────────────────────────────────────────────
  // Organization
  // ─────────────────────────────────────────────────────────────

  const orgSpinner = p.spinner();
  orgSpinner.start("Fetching organizations from api.supabase.com...");
  const orgs = await client.listOrganizations();
  orgSpinner.stop(`Found ${orgs.length} organization${orgs.length === 1 ? "" : "s"}`);

  // Track what we need to create at the end
  let existingOrg: Organization | null = null;
  let newOrgName: string | null = null;

  if (orgs.length === 0) {
    // Must create org
    const orgName = await p.text({
      message: "Organization name",
      placeholder: "my-org",
      defaultValue: `my-org-${Date.now().toString(36).slice(-4)}`,
    });

    if (isCancel(orgName)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    newOrgName = orgName;
  } else {
    // First ask: existing or new?
    const orgExamples = orgs.slice(0, 3).map((o) => o.name).join(", ") + (orgs.length > 3 ? ", ..." : "");
    const orgAction = await p.select({
      message: "Organization",
      options: [
        { value: "existing" as const, label: "Use existing", hint: orgExamples },
        { value: "new" as const, label: "Create new", hint: "Start fresh with a new org" },
      ],
    });

    if (isCancel(orgAction)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    if (orgAction === "new") {
      const orgName = await p.text({
        message: "Organization name",
        placeholder: "my-org",
        defaultValue: `my-org-${Date.now().toString(36).slice(-4)}`,
      });

      if (isCancel(orgName)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      newOrgName = orgName;
    } else {
      // Show searchable list of existing orgs
      const orgChoice = await searchSelect<Organization>({
        message: "Select organization",
        items: orgs.map((o) => ({ value: o, label: o.name, hint: o.slug })),
      });

      if (isCancel(orgChoice)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      existingOrg = orgChoice;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Project
  // ─────────────────────────────────────────────────────────────

  let existingProject: Project | null = null;
  let newProjectName: string | null = null;
  let newProjectRegion: Region | null = null;

  if (existingOrg) {
    // Existing org - fetch projects and let user choose
    const projectSpinner = p.spinner();
    projectSpinner.start("Fetching projects from api.supabase.com...");
    const allProjects = await client.listProjects();
    const orgProjects = allProjects.filter((proj) => proj.organization_slug === existingOrg!.slug);
    projectSpinner.stop(`Found ${orgProjects.length} project${orgProjects.length === 1 ? "" : "s"} in ${existingOrg.name}`);

    if (orgProjects.length === 0) {
      // Must create project
      const projectName = await p.text({
        message: "Project name",
        placeholder: "my-project",
        defaultValue: `my-project-${Date.now().toString(36).slice(-4)}`,
      });

      if (isCancel(projectName)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      const region = await searchSelect({
        message: "Region",
        items: REGIONS.map((r) => ({ value: r.value, label: r.label, hint: r.value })),
      });

      if (isCancel(region)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      newProjectName = projectName;
      newProjectRegion = region as Region;
    } else {
      // Choose existing or new
      const projectExamples = orgProjects.slice(0, 3).map((p) => p.name).join(", ") + (orgProjects.length > 3 ? ", ..." : "");
      const projectAction = await p.select({
        message: "Project",
        options: [
          { value: "existing" as const, label: "Use existing", hint: projectExamples },
          { value: "new" as const, label: "Create new", hint: "Start fresh with a new project" },
        ],
      });

      if (isCancel(projectAction)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      if (projectAction === "new") {
        const projectName = await p.text({
          message: "Project name",
          placeholder: "my-project",
          defaultValue: `my-project-${Date.now().toString(36).slice(-4)}`,
        });

        if (isCancel(projectName)) {
          p.cancel("Cancelled");
          process.exit(0);
        }

        const region = await searchSelect({
          message: "Region",
          items: REGIONS.map((r) => ({ value: r.value, label: r.label, hint: r.value })),
        });

        if (isCancel(region)) {
          p.cancel("Cancelled");
          process.exit(0);
        }

        newProjectName = projectName;
        newProjectRegion = region as Region;
      } else {
        // Show searchable list of existing projects
        const projectChoice = await searchSelect<Project>({
          message: "Select project",
          items: orgProjects.map((proj) => ({ value: proj, label: proj.name, hint: proj.region })),
        });

        if (isCancel(projectChoice)) {
          p.cancel("Cancelled");
          process.exit(0);
        }

        existingProject = projectChoice;
      }
    }
  } else {
    // New org - must create a new project
    const projectName = await p.text({
      message: "Project name",
      placeholder: "my-project",
      defaultValue: `my-project-${Date.now().toString(36).slice(-4)}`,
    });

    if (isCancel(projectName)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    const region = await searchSelect({
      message: "Region",
      items: REGIONS.map((r) => ({ value: r.value, label: r.label, hint: r.value })),
    });

    if (isCancel(region)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    newProjectName = projectName;
    newProjectRegion = region as Region;
  }

  // ─────────────────────────────────────────────────────────────
  // Template
  // ─────────────────────────────────────────────────────────────

  const cwd = process.cwd();
  await pickTemplate(cwd);

  // ─────────────────────────────────────────────────────────────
  // Schema Management
  // ─────────────────────────────────────────────────────────────

  const schemaManagement = await p.select({
    message: "Schema management",
    options: [
      { value: "declarative" as const, label: "Declarative (recommended)", hint: "Write what you want, we figure out the changes" },
      { value: "migrations" as const, label: "Migrations", hint: "Traditional versioned migration files" },
    ],
  });

  if (isCancel(schemaManagement)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  // ─────────────────────────────────────────────────────────────
  // Config Source
  // ─────────────────────────────────────────────────────────────

  const configSource = await p.select({
    message: "Config source",
    options: [
      { value: "code" as const, label: "In code (recommended)", hint: "config.json is source of truth" },
      { value: "remote" as const, label: "Remote (dashboard)", hint: "Dashboard is source of truth" },
    ],
  });

  if (isCancel(configSource)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  // ─────────────────────────────────────────────────────────────
  // Workflow Profile
  // ─────────────────────────────────────────────────────────────

  const profileChoice = await profileSelect(WORKFLOW_PROFILES);

  if (isCancel(profileChoice)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const workflowProfile = profileChoice.name;

  // ─────────────────────────────────────────────────────────────
  // GitHub (only for preview-git)
  // ─────────────────────────────────────────────────────────────

  if (workflowProfile === "preview-git") {
    const connectGithub = await p.confirm({
      message: "Connect GitHub repository?",
    });

    if (isCancel(connectGithub)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    // TODO: Actually connect GitHub if selected
  }

  // ─────────────────────────────────────────────────────────────
  // Create resources
  // ─────────────────────────────────────────────────────────────

  let finalOrg: Organization;
  let finalProject: { ref: string; name: string; region: string };
  let dbPassword: string | undefined;

  // Create org if needed
  if (newOrgName) {
    const createOrgSpinner = p.spinner();
    createOrgSpinner.start(`Creating organization "${newOrgName}"...`);
    finalOrg = await createOrgOp({ token, name: newOrgName });
    createOrgSpinner.stop(`Created organization "${newOrgName}"`);
  } else {
    finalOrg = existingOrg!;
  }

  // Create project if needed
  if (newProjectName && newProjectRegion) {
    const createProjectSpinner = p.spinner();
    createProjectSpinner.start(`Creating project "${newProjectName}"...`);
    const result = await createProjectOp({
      token,
      orgSlug: finalOrg.slug,
      region: newProjectRegion,
      name: newProjectName,
    });
    createProjectSpinner.stop(`Created project "${newProjectName}"`);
    finalProject = { ref: result.project.ref, name: newProjectName, region: newProjectRegion };
    dbPassword = result.dbPassword;
  } else {
    finalProject = {
      ref: existingProject!.ref,
      name: existingProject!.name,
      region: existingProject!.region,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Done - return result, init.ts handles the success screen
  // ─────────────────────────────────────────────────────────────

  return {
    ref: finalProject.ref,
    name: finalProject.name,
    schemaManagement,
    configSource,
    workflowProfile,
    dbPassword,
  };
}
