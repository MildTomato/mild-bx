/**
 * List all environments for the project
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";

export interface ListEnvironmentsOptions {
  json?: boolean;
  profile?: string;
}

/**
 * Default environments that always exist
 */
const DEFAULT_ENVIRONMENTS = ["development", "preview", "production"];

export async function listEnvironmentsCommand(
  options: ListEnvironmentsOptions
): Promise<void> {
  const ctx = await setupEnvCommand({
    command: "supa project env list-environments",
    description: "List all environments for the project.",
    json: options.json,
    profile: options.profile,
  });
  if (!ctx) return;

  // Derive environments from config.environments + hardcoded defaults
  const configEnvs = (ctx.config as Record<string, unknown>).environments as
    | Record<string, string>
    | undefined;

  const allEnvNames = new Set(DEFAULT_ENVIRONMENTS);

  // Add any custom environment names from the environments mapping
  if (configEnvs) {
    for (const envName of Object.values(configEnvs)) {
      allEnvNames.add(envName);
    }
  }

  const environments = Array.from(allEnvNames).map((name) => ({
    name,
    isDefault: DEFAULT_ENVIRONMENTS.includes(name),
    // Find branch patterns that map to this environment
    patterns: configEnvs
      ? Object.entries(configEnvs)
          .filter(([, env]) => env === name)
          .map(([pattern]) => pattern)
      : [],
  }));

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      environments,
    }));
    return;
  }

  console.log();
  for (const env of environments) {
    const tag = env.isDefault ? chalk.dim(" (default)") : "";
    const patterns =
      env.patterns.length > 0
        ? chalk.dim(` ← ${env.patterns.join(", ")}`)
        : "";
    console.log(`  ${chalk.cyan(env.name)}${tag}${patterns}`);
  }
  console.log();
  console.log(chalk.dim(`  ${environments.length} environment(s)`));

  if (configEnvs && Object.keys(configEnvs).length > 0) {
    console.log(
      chalk.dim(`  Branch mapping configured in config.json "environments"`)
    );
  }
}
