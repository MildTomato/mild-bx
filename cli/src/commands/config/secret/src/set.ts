import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { printCommandHeader, printContextExtra } from "@/components/command-header.js";
import { createSpinner, setOutputMode } from "@/components/output.js";
import { setRemoteVariable } from "@/lib/env-api-bridge.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { reconcileConfigTargets } from "@/lib/config-reconciler.js";
import {
  configSecretScope,
  envServerScope,
  resolveConfigSecretTarget,
  scopedConfigSecretName,
  writeConfigSecretRef,
} from "@/lib/config-secret.js";
import type { Scope } from "@supabase-dx/env-vars";

interface SetConfigSecretOptions {
  fieldOrEnv: string;
  value?: string;
  scope?: Scope;
  branch?: string;
  json?: boolean;
  profile?: string;
}

export async function setConfigSecret(options: SetConfigSecretOptions): Promise<void> {
  setOutputMode(options);
  const ctx = await resolveProjectContext(options);
  const target = resolveConfigSecretTarget(options.fieldOrEnv);
  const scope = configSecretScope({
    isBranch: ctx.isBranch,
    branch: ctx.branch,
    explicitScope: options.scope,
    explicitBranch: options.branch,
  });
  const storedKey = scopedConfigSecretName(target.envVar, scope.scope, scope.branch);

  if (!options.json) {
    printCommandHeader({
      command: "supa config secret set",
      description: ["Set a secret used by Supabase config."],
      context: [
        ["Project", ctx.projectRef],
        ["Profile", ctx.profile?.name || "default"],
      ],
    });
    printContextExtra([
      ["Field", target.path],
      ["Env", target.envVar],
      ["Scope", scope.scope === "branch" ? `branch:${scope.branch}` : scope.scope],
    ]);
  }

  let value = options.value;
  if (value === undefined) {
    if (!process.stdin.isTTY || options.json) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      value = Buffer.concat(chunks).toString("utf-8").trim();
    } else {
      const input = await p.password({
        message: `Secret value for ${target.envVar}`,
        validate: (v) => (!v ? "Value is required" : undefined),
      });
      if (p.isCancel(input)) {
        p.cancel("Cancelled");
        return;
      }
      value = String(input);
    }
  }

  const file = writeConfigSecretRef({
    cwd: ctx.cwd,
    scope: scope.scope,
    branch: scope.branch,
    path: target.path,
    envVar: target.envVar,
  });

  const client = createClient(ctx.token);
  const spinner = createSpinner();
  spinner.start("Saving config secret...");

  await setRemoteVariable(ctx.parentProjectRef, [{
    key: storedKey,
    value,
    secret: true,
    scope: envServerScope(scope.scope, scope.branch),
  }]);

  spinner.message("Reconciling config...");
  const reconcileResults = await reconcileConfigTargets({
    cwd: ctx.cwd,
    parentProjectRef: ctx.parentProjectRef,
    currentProjectRef: ctx.projectRef,
    currentBranch: ctx.branch,
    isBranch: ctx.isBranch,
    client,
    dryRun: false,
    verbose: false,
    includePreviewBranches: scope.scope === "preview" ? "all" : "none",
  });

  const missing = reconcileResults.filter((r) => r.missing.length > 0);
  if (missing.length > 0) {
    spinner.stop(chalk.yellow("Saved config secret with reconciliation warnings"));
  } else {
    spinner.stop(chalk.green("Config secret saved and synced"));
  }

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      field: target.path,
      env: target.envVar,
      storedKey,
      configFile: file,
      reconciledTargets: reconcileResults.length,
      warnings: missing.length,
    }));
  }
}
