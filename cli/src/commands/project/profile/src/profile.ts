/**
 * Profile command - view and set workflow profile
 */

import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_PROFILES } from "@/lib/workflow-profiles.js";
import type { WorkflowProfile } from "@/lib/config-types.js";
import { getWorkflowProfile } from "@/lib/config.js";
import { resolveConfig } from "@/lib/resolve-project.js";

interface ProfileOptions {
  set?: WorkflowProfile;
  json?: boolean;
}

function getPushDescription(profile: string): string {
  switch (profile) {
    case "solo": return "Push local changes directly to production";
    case "staged": return "Push local changes to staging for testing";
    case "preview": return "Push local changes to your preview environment";
    case "preview-git": return "Push local changes to branch preview environment";
    default: return "Push local changes to remote";
  }
}

function getPullDescription(profile: string): string {
  switch (profile) {
    case "solo": return "Pull production schema to local";
    case "staged": return "Pull staging schema to local";
    case "preview": return "Pull preview environment schema to local";
    case "preview-git": return "Pull branch preview schema to local";
    default: return "Pull remote schema to local";
  }
}

function hasMerge(profile: string): boolean {
  return profile !== "solo";
}

function getMergeDescription(profile: string): string {
  switch (profile) {
    case "staged": return "Promote staging to production";
    case "preview": return "Merge between environments (e.g. preview → production)";
    case "preview-git": return "Merge between environments (or use PR merge)";
    default: return "";
  }
}

function updateConfigProfile(cwd: string, newProfile: WorkflowProfile): boolean {
  const configPath = join(cwd, "supabase", "config.json");

  if (!existsSync(configPath)) {
    console.error(chalk.red("Error: supabase/config.json not found. Run `supa init` first."));
    return false;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);
    config.workflow_profile = newProfile;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return true;
  } catch (error) {
    console.error(chalk.red("Error updating config.json:"), error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function profileCommand(options: ProfileOptions) {
  const { cwd, config } = resolveConfig(options);

  const profileInfo = (name: string) => {
    const def = WORKFLOW_PROFILES.find(p => p.name === name);
    return def ? { name: def.name, title: def.title, description: def.description } : null;
  };

  const availableProfiles = WORKFLOW_PROFILES.map(p => ({
    name: p.name,
    title: p.title,
    description: p.description,
  }));

  const currentProfile = getWorkflowProfile(config);

  // Set profile
  if (options.set) {
    const newProfile = options.set;

    if (!WORKFLOW_PROFILES.find(p => p.name === newProfile)) {
      if (options.json) {
        console.log(JSON.stringify({
          error: "invalid_profile",
          message: `Invalid profile: ${newProfile}`,
          availableProfiles,
        }));
      } else {
        console.error(chalk.red(`Invalid profile: ${newProfile}`));
        console.log(chalk.dim(`Valid options: ${WORKFLOW_PROFILES.map(p => p.name).join(", ")}`));
      }
      process.exit(1);
    }

    if (!updateConfigProfile(cwd, newProfile)) {
      if (options.json) {
        console.log(JSON.stringify({ error: "update_failed", message: "Failed to update config" }));
      }
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify({
        profile: profileInfo(newProfile),
        previous: profileInfo(currentProfile),
        changed: true,
      }));
    } else {
      const definition = WORKFLOW_PROFILES.find(p => p.name === newProfile)!;
      console.log();
      console.log(`${chalk.dim("Profile updated -")} ${chalk.bold(newProfile)}`);
      console.log();
      console.log(chalk.dim(definition.description));
      console.log();
      console.log(chalk.dim("Commands:"));
      console.log(`  ${chalk.dim("supa push")}  ${getPushDescription(newProfile)}`);
      console.log(`  ${chalk.dim("supa pull")}  ${getPullDescription(newProfile)}`);
      if (hasMerge(newProfile)) {
        console.log(`  ${chalk.dim("supa merge")} ${getMergeDescription(newProfile)}`);
      }
    }
    return;
  }

  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      profile: profileInfo(currentProfile),
      availableProfiles,
      usage: { change: "supa project profile --set <name>" },
    }));
    return;
  }

  // Show current profile and available options
  const currentDef = WORKFLOW_PROFILES.find(p => p.name === currentProfile);
  const maxNameLen = Math.max(...WORKFLOW_PROFILES.map(p => p.name.length));

  console.log();
  if (currentDef) {
    console.log(chalk.bold(currentDef.title));
    console.log(chalk.dim(currentDef.description));
    console.log();
  }

  console.log(chalk.dim("Profiles:"));
  for (const p of WORKFLOW_PROFILES) {
    const isCurrent = p.name === currentProfile;
    const name = isCurrent ? chalk.cyan(p.name.padEnd(maxNameLen)) : p.name.padEnd(maxNameLen);
    const suffix = isCurrent ? chalk.cyan(" (current)") : "";
    console.log(`  ${name}  ${chalk.dim(p.title)}${suffix}`);
  }

  console.log();
  console.log(chalk.dim("Usage:"));
  console.log("  supa project profile --set <name>");
}
