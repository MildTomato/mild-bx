import * as p from "@clack/prompts";
import { resolveProjectContext } from "@/lib/resolve-project.js";
import { listRemoteVariables, deleteRemoteVariable } from "@/lib/env-api-bridge.js";
import { printCommandHeader, printProjectContextLines } from "@/components/command-header.js";
import type { EnvScope } from "@/lib/env-server-types.js";

export interface ResetOptions {
  yes?: boolean;
  json?: boolean;
  profile?: string;
}

export async function resetEnvServer(options: ResetOptions = {}): Promise<void> {
  const ctx = await resolveProjectContext({ ...options, skipBranchResolution: true });
  const { parentProjectRef } = ctx;

  if (!options.json) {
    printCommandHeader({
      command: "supa project env-server reset",
      description: ["Clear all env-server entries for this project."],
    });
    printProjectContextLines({
      parentRef: parentProjectRef,
      profileName: ctx.profile?.name,
    });
  }

  const all = await listRemoteVariables(parentProjectRef);

  if (all.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ deleted: 0 }));
    } else {
      p.log.info("No env-server entries found for this project.");
    }
    return;
  }

  if (!options.yes && !options.json) {
    const confirmed = await p.confirm({
      message: `Delete ${all.length} env-server entries for ${parentProjectRef}?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled");
      return;
    }
  }

  await Promise.allSettled(
    all.map((v) => deleteRemoteVariable(parentProjectRef, v.key, (v.scope ?? "production") as EnvScope))
  );

  if (options.json) {
    console.log(JSON.stringify({ deleted: all.length }));
  } else {
    p.log.success(`Deleted ${all.length} entries.`);
  }
}
