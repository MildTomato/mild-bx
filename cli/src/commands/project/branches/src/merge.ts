import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { diffRemoteAuthConfig, diffRemotePostgrestConfig, buildAuthApiUpdatePayload, buildPostgrestApiUpdatePayload } from "@supabase-dx/config";
import { createSpinner, setOutputMode } from "@/components/output.js";
import { reconcileConfigTargets } from "@/lib/config-reconciler.js";
import { deleteRemoteVariable, listRemoteVariables, setRemoteVariable } from "@/lib/env-api-bridge.js";
import { isSchemaSecretEnvVar } from "@/lib/config-ref.js";
import { branchToScope, parseScopedVarName, scopedVarName } from "@supabase-dx/env-vars";
import type { EnvScope } from "@/lib/env-server-types.js";

export interface MergeOptions {
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
  profile?: string;
  schemas?: string;
}

export async function mergeBranch(options: MergeOptions = {}): Promise<void> {
  const { cwd, branch, projectRef, parentProjectRef, token, isBranch } = await resolveProjectContext({
    ...options,
    skipBranchResolution: false,
  });

  if (!isBranch || !parentProjectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Not on a preview branch. Switch to a branch git branch first." }));
    } else {
      console.error(chalk.red("Not on a preview branch. Switch to a branch git branch first."));
    }
    process.exit(1);
  }

  const client = createClient(token);
  const envVars = await listRemoteVariables(parentProjectRef).catch(() => []);
  const branchSecretSuffix = branchToScope(branch);
  const branchConfigSecrets = envVars.filter((v) => {
    const parsed = parseScopedVarName(v.key);
    return parsed.scope === "branch" && parsed.branch === branchSecretSuffix && isSchemaSecretEnvVar(parsed.base);
  });
  const envKeys = new Set(envVars.map((v) => v.key));
  const missingProductionSecrets = branchConfigSecrets
    .map((v) => parseScopedVarName(v.key).base)
    .filter((key) => !envKeys.has(scopedVarName(key, "production")));

  if (missingProductionSecrets.length > 0) {
    const message = `Missing production config secret${missingProductionSecrets.length === 1 ? "" : "s"}: ${missingProductionSecrets.join(", ")}`;
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message, missingProductionSecrets }));
    } else {
      console.error(chalk.bgYellow.black.bold(" MISSING PRODUCTION SECRET "));
      for (const key of missingProductionSecrets) {
        console.error(`  ${chalk.dim("•")} ${key}`);
        console.error(`    ${chalk.dim("→")} supa config secret set ${key} <value> --scope production`);
      }
    }
    process.exit(1);
  }

  // Fetch schema diff + config from both sides in parallel
  const [schemaDiffResult, branchAuth, prodAuth, branchPostgrest, prodPostgrest] = await Promise.allSettled([
    client.getBranchDiff(projectRef, options.schemas ?? "public"),
    client.getAuthConfig(projectRef),
    client.getAuthConfig(parentProjectRef),
    client.getPostgrestConfig(projectRef),
    client.getPostgrestConfig(parentProjectRef),
  ]);

  const schema = schemaDiffResult.status === "fulfilled" ? schemaDiffResult.value : "";

  const authDiffs =
    branchAuth.status === "fulfilled" && prodAuth.status === "fulfilled"
      ? diffRemoteAuthConfig(
          prodAuth.value as Record<string, unknown>,
          branchAuth.value as Record<string, unknown>,
        )
      : [];

  const postgrestDiffs =
    branchPostgrest.status === "fulfilled" && prodPostgrest.status === "fulfilled"
      ? diffRemotePostgrestConfig(
          prodPostgrest.value as Record<string, unknown>,
          branchPostgrest.value as Record<string, unknown>,
        )
      : [];

  const hasConfigDiffs = authDiffs.length > 0 || postgrestDiffs.length > 0;

  if (!schema && !hasConfigDiffs) {
    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: "No differences — nothing to merge.", dry_run: options.dryRun ?? false }));
    } else {
      console.log(chalk.green("No differences — nothing to merge."));
    }
    process.exit(0);
  }

  if (options.json) {
    if (options.dryRun) {
      console.log(JSON.stringify({
        status: "success",
        dry_run: true,
        schema,
        config: { auth: authDiffs, api: postgrestDiffs },
      }));
      return;
    }
  } else {
    console.log();
    console.log(chalk.dim(options.dryRun ? "Dry run — changes that would be merged to production:" : "Changes that will be merged to production:"));

    if (schema) {
      console.log();
      console.log(chalk.dim("Schema:"));
      console.log(schema);
    }

    if (authDiffs.length > 0) {
      console.log();
      console.log(chalk.dim("Auth config:"));
      for (const d of authDiffs) {
        console.log(`  ${chalk.yellow(d.key)}: ${chalk.red(String(d.from))} -> ${chalk.green(String(d.to))}`);
      }
    }

    if (postgrestDiffs.length > 0) {
      console.log();
      console.log(chalk.dim("API config:"));
      for (const d of postgrestDiffs) {
        console.log(`  ${chalk.yellow(d.key)}: ${chalk.red(String(d.from))} -> ${chalk.green(String(d.to))}`);
      }
    }

    console.log();
    if (options.dryRun) return;
  }

  // Confirm unless --yes or non-TTY
  if (!options.yes && process.stdin.isTTY) {
    const proceed = await p.confirm({ message: "Merge these changes to production?" });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled");
      process.exit(0);
    }
  }

  // Apply: schema merge + config promotion to production
  const spinner = createSpinner();
  spinner.start("Merging to production...");

  try {
    const tasks: Promise<unknown>[] = [];

    if (schema) {
      tasks.push(client.mergeBranch(projectRef));
    }

    if (authDiffs.length > 0 && branchAuth.status === "fulfilled") {
      const authUpdate = buildAuthApiUpdatePayload(branchAuth.value as Record<string, unknown>, authDiffs);
      tasks.push(client.updateAuthConfig(parentProjectRef, authUpdate));
    }

    if (postgrestDiffs.length > 0 && branchPostgrest.status === "fulfilled") {
      const postgrestUpdate = buildPostgrestApiUpdatePayload(branchPostgrest.value as Record<string, unknown>, postgrestDiffs);
      tasks.push(client.updatePostgrestConfig(parentProjectRef, postgrestUpdate));
    }

    await Promise.all(tasks);

    if (branchConfigSecrets.length > 0) {
      spinner.message("Promoting branch config secrets to preview...");
      await Promise.all(branchConfigSecrets.map(async (secret) => {
        const parsed = parseScopedVarName(secret.key);
        if (parsed.scope !== "branch") return;
        await setRemoteVariable(parentProjectRef, [{
          key: scopedVarName(parsed.base, "preview"),
          value: secret.value,
          secret: true,
          scope: "preview",
        }]);
        if (secret.scope) {
          await deleteRemoteVariable(parentProjectRef, secret.key, secret.scope as EnvScope);
        }
      }));
    }

    spinner.message("Reconciling preview branches...");
    await reconcileConfigTargets({
      cwd,
      parentProjectRef,
      currentProjectRef: projectRef,
      currentBranch: branch,
      isBranch,
      client,
      dryRun: options.dryRun,
      verbose: false,
      includePreviewBranches: "all",
    });

    spinner.stop(chalk.green("Merged to production."));

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        message: "Branch merged to production.",
        schemaApplied: !!schema,
        configApplied: hasConfigDiffs,
      }));
    }
  } catch (error) {
    spinner.stop(chalk.red("Merge failed"));
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "Merge failed" }));
    } else {
      console.error(chalk.red("Merge failed:"), error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}
