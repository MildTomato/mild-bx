/**
 * supa config diff — show field-level config diff between two branches
 */

import { resolveProjectContext } from "@/lib/resolve-project.js";
import { diffConfig } from "@/lib/config-storage-bridge.js";
import { printCommandHeader, printProjectContextLines, S_BAR } from "@/components/command-header.js";
import { C } from "@/lib/colors.js";
import { EXIT_CODES } from "@/lib/exit-codes.js";

export interface DiffConfigOptions {
  from: string;
  to: string;
  profile?: string;
  json?: boolean;
}

export async function diffConfigCommand(options: DiffConfigOptions): Promise<number> {
  const ctx = await resolveProjectContext(options);
  const { parentProjectRef } = ctx;

  if (!options.json) {
    printCommandHeader({
      command: "supa config diff",
      description: [`Show field-level config changes from ${options.from} to ${options.to}.`],
    });
    printProjectContextLines({
      parentRef: parentProjectRef,
      branchRef: ctx.isBranch ? ctx.projectRef : undefined,
      gitBranch: ctx.branch,
      profileName: ctx.profile?.name,
    });
  }

  let result: Awaited<ReturnType<typeof diffConfig>>;
  try {
    result = await diffConfig(parentProjectRef, options.from, options.to);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.error(JSON.stringify({ status: "error", message: msg }));
    } else {
      console.error(`${C.error}Error:${C.reset} ${msg}`);
      console.error(`  Make sure both branches have been pushed via \`supa push\` first.`);
    }
    return EXIT_CODES.NETWORK_ERROR;
  }

  if (options.json) {
    console.log(JSON.stringify({ status: "success", from: options.from, to: options.to, ...result }));
    return EXIT_CODES.SUCCESS;
  }

  console.log(S_BAR);
  console.log(`${S_BAR}  ${`\x1b[2mFrom:\x1b[0m`.padEnd(18)} ${options.from}`);
  console.log(`${S_BAR}  ${`\x1b[2mTo:\x1b[0m`.padEnd(18)} ${options.to}`);
  console.log(S_BAR);

  if (!result.hasChanges) {
    console.log(`${S_BAR}  ${C.success}No config differences between branches.${C.reset}`);
    console.log(S_BAR);
    return EXIT_CODES.SUCCESS;
  }

  const printEntry = (label: string, color: string, path: string, value: unknown) => {
    const val = typeof value === "object" ? JSON.stringify(value) : String(value);
    console.log(`${S_BAR}  ${color}${label}${C.reset}  ${`\x1b[2m${path}\x1b[0m`.padEnd(50)}  ${val}`);
  };

  if (result.added.length > 0) {
    console.log(`${S_BAR}  ${C.success}Added (${result.added.length})${C.reset}`);
    for (const entry of result.added) {
      printEntry("+ ", C.success, entry.path, entry.value);
    }
  }

  if (result.changed.length > 0) {
    console.log(`${S_BAR}  ${C.warning}Changed (${result.changed.length})${C.reset}`);
    for (const entry of result.changed) {
      const fromVal = typeof entry.from === "object" ? JSON.stringify(entry.from) : String(entry.from);
      const toVal = typeof entry.to === "object" ? JSON.stringify(entry.to) : String(entry.to);
      console.log(`${S_BAR}  ${C.warning}~${C.reset}  ${`\x1b[2m${entry.path}\x1b[0m`.padEnd(50)}  ${fromVal} ${C.secondary}→${C.reset} ${toVal}`);
    }
  }

  if (result.removed.length > 0) {
    console.log(`${S_BAR}  ${C.error}Removed (${result.removed.length})${C.reset}`);
    for (const entry of result.removed) {
      printEntry("- ", C.error, entry.path, entry.value);
    }
  }

  console.log(S_BAR);
  return EXIT_CODES.SUCCESS;
}
