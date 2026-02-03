import React from "react";
import { render, Text, Box } from "ink";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_PROFILES } from "../lib/workflow-profiles.js";
import type { WorkflowProfile } from "../lib/config-types.js";
import { loadProjectConfig, getWorkflowProfile } from "../lib/config.js";
import { Output } from "../components/Print.js";
import { ProfileArt } from "../components/ProfileArt.js";
import { StyleReset } from "../components/StyleReset.js";

/** Command behavior descriptions per profile */
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

/** Options for the `supa project profile` command */
interface ProfileOptions {
  /** Set the profile to this value (e.g. "solo", "staged") */
  set?: WorkflowProfile;
  /** Output as JSON instead of human-readable format */
  json?: boolean;
}

/**
 * Update the workflow_profile field in supabase/config.json.
 * Reads the existing config, updates the profile, and writes back.
 *
 * @param cwd - Working directory containing the supabase folder
 * @param newProfile - The profile to set
 * @returns true if successful, false if config not found or write failed
 */
function updateConfigProfile(cwd: string, newProfile: WorkflowProfile): boolean {
  const configPath = join(cwd, "supabase", "config.json");

  if (!existsSync(configPath)) {
    console.error("Error: supabase/config.json not found. Run `supa init` first.");
    return false;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Update the profile
    config.workflow_profile = newProfile;

    // Write back with pretty formatting
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    return true;
  } catch (error) {
    console.error("Error updating config.json:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Handler for `supa project profile` command.
 *
 * Behavior:
 * - No flags: interactive picker showing all profiles, current one marked
 * - `--set <profile>`: non-interactive change to specified profile
 * - `--json`: outputs current profile as JSON (for scripting)
 *
 * Requires a supabase project (config.json) to exist.
 */
export async function profileCommand(options: ProfileOptions) {
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);

  // Helper to build profile info for JSON output
  const profileInfo = (name: string) => {
    const def = WORKFLOW_PROFILES.find(p => p.name === name);
    return def ? { name: def.name, title: def.title, description: def.description } : null;
  };

  const availableProfiles = WORKFLOW_PROFILES.map(p => ({
    name: p.name,
    title: p.title,
    description: p.description,
  }));

  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({
        error: "not_initialized",
        message: "No supabase project found. Run `supa init` first.",
        availableProfiles,
      }));
    } else {
      render(
        <Output>
          <Text color="red">No supabase project found. Run `supa init` first.</Text>
        </Output>
      );
    }
    process.exit(1);
  }

  const currentProfile = getWorkflowProfile(config);

  // If --set flag is provided, update the profile
  if (options.set) {
    const newProfile = options.set;

    // Validate profile
    if (!WORKFLOW_PROFILES.find(p => p.name === newProfile)) {
      if (options.json) {
        console.log(JSON.stringify({
          error: "invalid_profile",
          message: `Invalid profile: ${newProfile}`,
          availableProfiles,
        }));
      } else {
        render(
          <Output>
            <Text color="red">Invalid profile: {newProfile}</Text>
            <Text dimColor>Valid options: {WORKFLOW_PROFILES.map(p => p.name).join(", ")}</Text>
          </Output>
        );
      }
      process.exit(1);
    }

    // Update config
    if (!updateConfigProfile(cwd, newProfile)) {
      if (options.json) {
        console.log(JSON.stringify({
          error: "update_failed",
          message: "Failed to update config",
        }));
      } else {
        render(
          <Output>
            <Text color="red">Failed to update config</Text>
          </Output>
        );
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
      const SuccessUI = () => (
        <Output>
          <Box>
            <Text dimColor>Profile updated -</Text>
            <StyleReset />
            <Text bold>{newProfile}</Text>
          </Box>
          <Text>{''}</Text>
          <Text dimColor>{definition.description}</Text>
          <ProfileArt profile={definition} hideHeader hideDescription />
          <Text dimColor>Commands:</Text>
          <Text>  <Text dimColor>supa push</Text>  {getPushDescription(newProfile)}</Text>
          <Text>  <Text dimColor>supa pull</Text>  {getPullDescription(newProfile)}</Text>
          {hasMerge(newProfile) && (
            <Text>  <Text dimColor>supa merge</Text> {getMergeDescription(newProfile)}</Text>
          )}
        </Output>
      );
      render(<SuccessUI />);
    }

    return;
  }

  // JSON output for current profile
  if (options.json) {
    console.log(JSON.stringify({
      profile: profileInfo(currentProfile),
      availableProfiles,
      usage: {
        change: "supa project profile --set <name>",
      },
    }));
    return;
  }

  // Show current profile diagram and available options
  const currentDef = WORKFLOW_PROFILES.find(p => p.name === currentProfile);

  // Pad profile names to align descriptions
  const maxNameLen = Math.max(...WORKFLOW_PROFILES.map(p => p.name.length));

  const ProfileHelpUI = () => (
    <Output>
      {currentDef && <ProfileArt profile={currentDef} />}
      <Text dimColor>Profiles:</Text>
      {WORKFLOW_PROFILES.map(p => (
        <Text key={p.name}>
          <Text>  </Text>
          <Text color={p.name === currentProfile ? "cyan" : undefined}>
            {p.name.padEnd(maxNameLen)}
          </Text>
          <Text dimColor>  {p.title}</Text>
          {p.name === currentProfile && <Text color="cyan"> (current)</Text>}
        </Text>
      ))}
      <Text>{''}</Text>
      <Text dimColor>Usage:</Text>
      <Text>  supa project profile --set {'<name>'}</Text>
    </Output>
  );

  render(<ProfileHelpUI />);
}
