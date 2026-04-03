/**
 * supa config show — display the effective merged config
 */

import { join } from "node:path";
import { loadProjectConfig, getEnvironmentForBranch } from "@/lib/config.js";
import { loadEffectiveConfig } from "@/lib/config-overlay.js";
import { getCurrentBranch } from "@/lib/git.js";
import { printCommandHeader, S_BAR } from "@/components/command-header.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";
import { C } from "@/lib/colors.js";

export interface ShowConfigOptions {
  env?: string;
  json?: boolean;
}

export async function showConfigCommand(options: ShowConfigOptions): Promise<void> {
  const cwd = process.cwd();
  const branch = getCurrentBranch(cwd) || "main";

  // Two-step load: derive env from base, then apply overlays.
  const base = loadProjectConfig(cwd);
  if (!base) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "No config found" }));
    } else {
      console.error(`${C.error}Error:${C.reset} No supabase/config.json found. Run \`supa init\` first.`);
    }
    process.exitCode = EXIT_CODES.CONFIG_NOT_FOUND;
    return;
  }

  // Allow explicit --env override, otherwise derive from branch mapping.
  const env = options.env ?? getEnvironmentForBranch(base, branch);

  const { config, layers } = loadEffectiveConfig(cwd, env, branch);

  if (options.json) {
    console.log(JSON.stringify({ status: "success", layers, config }, null, 2));
    return;
  }

  // Human-readable output
  printCommandHeader({
    command: "supa config show",
    description: ["Show the effective merged config for the current environment."],
  });

  // Layers header
  console.log(S_BAR);
  console.log(`${S_BAR}  ${`\x1b[2mEnv:\x1b[0m`.padEnd(18)} ${env}`);
  if (layers.length > 1) {
    console.log(`${S_BAR}  ${`\x1b[2mConfig:\x1b[0m`.padEnd(18)} ${layers.join(" + ")}`);
  } else {
    console.log(`${S_BAR}  ${`\x1b[2mConfig:\x1b[0m`.padEnd(18)} ${layers[0] ?? "config.json"}`);
  }
  console.log(S_BAR);

  // Pretty-printed merged config
  const configJson = JSON.stringify(config, null, 2);
  for (const line of configJson.split("\n")) {
    console.log(`${S_BAR}  ${line}`);
  }
  console.log(S_BAR);
  console.log();
}
