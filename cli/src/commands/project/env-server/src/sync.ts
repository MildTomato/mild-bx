import * as p from "@clack/prompts";
import { createClient } from "@/lib/api.js";
import { resolveProjectContext, resolveEnvScope } from "@/lib/resolve-project.js";
import { listRemoteVariables, deleteRemoteVariable, setRemoteVariable } from "@/lib/env-api-bridge.js";
import { printCommandHeader, printProjectContextLines } from "@/components/command-header.js";
import { PROVIDER_DEFINITIONS, parseProviderFromRemote, providerPayloadToEnvVars, buildProviderPayload } from "@/lib/auth-providers.js";
import type { EnvScope } from "@/lib/env-server-types.js";

export interface SyncOptions {
  json?: boolean;
  profile?: string;
}

export async function syncEnvServer(options: SyncOptions = {}): Promise<void> {
  const ctx = await resolveProjectContext(options);
  const { parentProjectRef, token } = ctx;
  const scope = resolveEnvScope(ctx);

  if (!options.json) {
    printCommandHeader({
      command: "supa project env-server sync",
      description: ["Clear env-server and re-sync from remote project config."],
    });
    printProjectContextLines({
      parentRef: parentProjectRef,
      branchRef: ctx.isBranch ? ctx.projectRef : undefined,
      gitBranch: ctx.branch,
      profileName: ctx.profile?.name,
    });
  }

  const spinner = !options.json ? p.spinner() : null;

  // Step 1: clear only auth-provider entries for this scope — do not delete
  // manually-set vars or config-scope entries (those are not reconstructed below).
  spinner?.start("Clearing existing auth provider entries…");
  const existing = await listRemoteVariables(parentProjectRef, scope);
  const authKeys = new Set(
    PROVIDER_DEFINITIONS.flatMap((def) =>
      providerPayloadToEnvVars(buildProviderPayload(def, {} as Record<string, unknown>)).map((v) => v.key)
    )
  );
  const authEntries = existing.filter((v) => authKeys.has(v.key));
  await Promise.allSettled(
    authEntries.map((v) => deleteRemoteVariable(parentProjectRef, v.key, (v.scope ?? "production") as EnvScope))
  );
  spinner?.stop(`Cleared ${authEntries.length} existing auth entries`);

  // Step 2: fetch remote auth config
  spinner?.start("Fetching remote auth config…");
  const client = createClient(token);
  const remoteAuth = await client.getAuthConfig(parentProjectRef);
  spinner?.stop("Fetched remote auth config");

  // Step 3: extract provider env vars and write to env-server
  const vars: Array<{ key: string; value: string; secret: boolean; scope: EnvScope }> = [];

  for (const def of PROVIDER_DEFINITIONS) {
    const config = parseProviderFromRemote(def, remoteAuth as Record<string, unknown>);
    if (!config) continue;
    const payload = buildProviderPayload(def, config);
    const envVars = providerPayloadToEnvVars(payload);
    for (const v of envVars) {
      vars.push({ ...v, scope });
    }
  }

  if (vars.length > 0) {
    spinner?.start(`Writing ${vars.length} env vars to env-server…`);
    await setRemoteVariable(parentProjectRef, vars);
    spinner?.stop(`Wrote ${vars.length} env vars with scope "${scope}"`);
  } else {
    if (!options.json) p.log.info("No auth provider credentials found on remote.");
  }

  if (options.json) {
    console.log(JSON.stringify({ cleared: existing.length, written: vars.length, scope }));
  }
}
