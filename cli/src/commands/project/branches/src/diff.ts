import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { diffRemoteAuthConfig, diffRemotePostgrestConfig } from "@supabase-dx/config";
import { printHeader } from "@/components/command-header.js";
import { createSpinner } from "@/components/output.js";

export interface DiffOptions {
  json?: boolean;
  profile?: string;
  schemas?: string;
}

export async function diffBranch(options: DiffOptions = {}): Promise<void> {
  const ctx = await resolveProjectContext({ ...options, skipBranchResolution: false });
  const { projectRef, parentProjectRef, token, branch, isBranch } = ctx;

  if (!isBranch || !parentProjectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: "error", message: "Not on a preview branch." }));
    } else {
      p.log.error("Not on a preview branch. Switch to a branch git branch first.");
    }
    process.exit(1);
  }

  if (!options.json) {
    printHeader("supa project branches diff", "Show differences between this branch and production.", ctx);
  }

  const client = createClient(token);
  const spinner = createSpinner(options);
  spinner.start("Comparing branch with production...");

  const [schemaDiff, branchAuth, prodAuth, branchPostgrest, prodPostgrest] = await Promise.allSettled([
    client.getBranchDiff(projectRef, options.schemas ?? "public"),
    client.getAuthConfig(projectRef),
    client.getAuthConfig(parentProjectRef),
    client.getPostgrestConfig(projectRef),
    client.getPostgrestConfig(parentProjectRef),
  ]);

  const schema = schemaDiff.status === "fulfilled" ? schemaDiff.value : null;

  const authDiffs =
    branchAuth.status === "fulfilled" && prodAuth.status === "fulfilled"
      ? diffRemoteAuthConfig(
          branchAuth.value as Record<string, unknown>,
          prodAuth.value as Record<string, unknown>,
        )
      : [];

  const postgrestDiffs =
    branchPostgrest.status === "fulfilled" && prodPostgrest.status === "fulfilled"
      ? diffRemotePostgrestConfig(
          branchPostgrest.value as Record<string, unknown>,
          prodPostgrest.value as Record<string, unknown>,
        )
      : [];

  const hasConfigDiffs = authDiffs.length > 0 || postgrestDiffs.length > 0;
  const hasChanges = schema || hasConfigDiffs;

  if (options.json) {
    console.log(JSON.stringify({
      status: "success",
      schema: schema || "",
      config: { auth: authDiffs, api: postgrestDiffs },
    }));
    return;
  }

  if (!hasChanges) {
    spinner.stop("No differences — branch is in sync with production.");
    return;
  }

  spinner.stop("Diff ready");

  const SECRET_KEYS = /secret|password|token|key/i;

  const printConfigDiffs = (diffs: typeof authDiffs, label: string) => {
    if (diffs.length === 0) return;
    const displayVal = (key: string, v: unknown): string => {
      if (v === null || v === undefined || v === "") return "(not set)";
      const str = String(v);
      return SECRET_KEYS.test(key) && str.length > 8 ? "[redacted]" : str;
    };
    console.log();
    console.log(chalk.bold(label));
    for (const d of diffs) {
      const from = chalk.red(displayVal(d.key, d.from));
      const to = chalk.green(displayVal(d.key, d.to));
      console.log(`  ${chalk.yellow(d.key)}: ${from} -> ${to}`);
    }
  };

  if (schema) {
    console.log();
    console.log(chalk.bold("Schema"));
    console.log(schema.trim());
  }

  printConfigDiffs(authDiffs, "Auth config");
  printConfigDiffs(postgrestDiffs, "API config");
  console.log();
}
