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
import { getSecretRefs } from "@/lib/config-ref.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";

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
    process.exit(EXIT_CODES.VALIDATION_ERROR);
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

  // Check if this key is a secret() ref in config — takes precedence over everything
  const secretRefs = getSecretRefs(ctx.config);
  const isConfigSecret = secretRefs.has(options.key);

  function rejectSecretInNonTTY(): never {
    const msg = "Secrets must be set interactively. Run this command in your terminal.";
    if (options.json) {
      console.error(JSON.stringify({ status: "error", message: msg }));
    } else {
      p.log.error(msg);
    }
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  // Get the value - from arg, stdin, or prompt
  let value = options.value;
  if (value === undefined) {
    if (isConfigSecret && process.stdin.isTTY) {
      // TTY: use masked prompt so the secret never appears on screen
      const input = await p.password({
        message: `Secret value for ${options.key}`,
        validate: (v) => { if (!v) return "Value is required"; },
      });
      if (p.isCancel(input)) {
        p.cancel("Cancelled");
        return;
      }
      value = String(input);
    } else if (!isConfigSecret && process.stdin.isTTY) {
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
      // Non-TTY: read from stdin (supports `echo $SECRET | supa env set KEY`)
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      value = Buffer.concat(chunks).toString("utf-8").trim();
    }
  }

  // Determine if secret — config ref takes precedence, then flag, then heuristic
  let isSecret: boolean;
  if (isConfigSecret) {
    isSecret = true;
  } else {
    let resolvedSecret = options.secret;
    if (resolvedSecret === undefined && process.stdout.isTTY && !options.json) {
      const defaultSecret = isSensitiveKey(options.key);
      const markSecret = await p.confirm({
        message: "Mark as secret?",
        initialValue: defaultSecret,
      });
      if (p.isCancel(markSecret)) {
        p.cancel("Cancelled");
        return;
      }
      resolvedSecret = markSecret;
    }
    isSecret = resolvedSecret ?? isSensitiveKey(options.key);
  }

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
