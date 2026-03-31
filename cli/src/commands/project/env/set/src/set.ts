/**
 * Set a single environment variable
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { isSensitiveKey } from "@/lib/env-file.js";
import { setRemoteVariable, warnIfUnrecognisedPlatformVar } from "@/lib/env-api-bridge.js";
import { scopedVarName, type Scope } from "@supabase-dx/env-vars";
import { createSpinner } from "@/components/output.js";

export interface SetOptions {
  key: string;
  value?: string;
  scope?: Scope;
  branch?: string;
  secret?: boolean;
  json?: boolean;
  profile?: string;
}

export async function setCommand(options: SetOptions): Promise<void> {
  const scope = options.scope ?? "production";

  if (scope === "branch" && !options.branch) {
    console.error("Error: --branch is required when --scope is 'branch'");
    process.exit(1);
  }

  const storedKey = scopedVarName(options.key, scope, options.branch);

  const scopeLabel = scope === "branch"
    ? `branch:${options.branch}`
    : scope;

  const context: [string, string][] = [
    ["Key", storedKey],
    ["Scope", scopeLabel],
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

  // Get the value - from arg, stdin, or prompt
  let value = options.value;
  if (value === undefined) {
    if (process.stdin.isTTY) {
      const input = await p.text({
        message: `Value for ${options.key}`,
        placeholder: "Enter value",
        validate: (v) => {
          if (!v) return "Value is required";
        },
      });
      if (p.isCancel(input)) {
        p.cancel("Cancelled");
        return;
      }
      value = String(input);
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      value = Buffer.concat(chunks).toString("utf-8").trim();
    }
  }

  // Determine if secret
  let isSecret = options.secret;
  if (isSecret === undefined && process.stdout.isTTY && !options.json) {
    const defaultSecret = isSensitiveKey(options.key);
    const markSecret = await p.confirm({
      message: "Mark as secret?",
      initialValue: defaultSecret,
    });
    if (p.isCancel(markSecret)) {
      p.cancel("Cancelled");
      return;
    }
    isSecret = markSecret;
  }
  isSecret = isSecret ?? isSensitiveKey(options.key);

  const warning = warnIfUnrecognisedPlatformVar(options.key);
  if (warning) {
    if (options.json) {
      console.error(JSON.stringify({ status: "warning", message: warning }));
    } else {
      p.log.warn(warning);
    }
  }

  // Push to remote with the scoped key
  const client = createClient(ctx.token);
  const spinner = createSpinner(options);
  spinner.start(`Setting ${storedKey}...`);

  try {
    await setRemoteVariable( ctx.parentProjectRef, [{ key: storedKey, value, secret: isSecret ?? false }]);
    spinner.stop(`Set ${chalk.cyan(storedKey)} (scope: ${scopeLabel})`);

    if (scope === "preview") {
      const { propagateToPreviewBranches } = await import("@/lib/env-propagate.js");
      await propagateToPreviewBranches({ client, projectRef: ctx.parentProjectRef });
    }

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        key: options.key,
        storedKey,
        scope: scopeLabel,
      }));
    }
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }
}
