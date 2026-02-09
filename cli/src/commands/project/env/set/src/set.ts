/**
 * Set a single environment variable
 */

import chalk from "chalk";
import { setupEnvCommand, printNotImplemented } from "../../setup.js";

export interface SetOptions {
  key: string;
  value?: string;
  environment?: string;
  branch?: string;
  secret?: boolean;
  json?: boolean;
  profile?: string;
}

export async function setCommand(options: SetOptions): Promise<void> {
  const environment = options.environment || "development";
  const target = options.branch
    ? `${environment} (branch: ${options.branch})`
    : environment;

  const context: [string, string][] = [
    ["Env", target],
    ["Key", options.key],
  ];
  if (options.secret) {
    context.push(["Secret", chalk.yellow("yes")]);
  }

  const ctx = await setupEnvCommand({
    command: "supa project env set",
    description: "Set a single environment variable.",
    json: options.json,
    profile: options.profile,
    context,
  });
  if (!ctx) return;

  // TODO: Implement full set logic when API is available
  //
  // 1. If VALUE not provided, prompt interactively or read from stdin
  // 2. If --secret not provided and not updating existing var:
  //    - Prompt: "Mark as secret? [Y/n]" (default yes if isSensitiveKey(key))
  // 3. Call client.setEnvVariable(projectRef, environment, { key, value, secret?, branch? })

  printNotImplemented();
}
