/**
 * Environment API bridge — talks to the local env-server (http://localhost:3457).
 */
import type { EnvVariable } from "./env-types.js";
import type { EnvScope } from "./env-server-types.js";

const ENV_SERVER_URL = process.env.ENV_SERVER_URL ?? "http://localhost:3457";
const VERBOSE = process.env.SUPA_VERBOSE === "1" || process.env.SUPA_VERBOSE === "true";

function log(msg: string) {
  if (VERBOSE) process.stderr.write(`[env-server] ${msg}\n`);
}

async function envFetch(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${ENV_SERVER_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`env-server ${options?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res;
}

export async function listRemoteVariables(
  projectRef: string,
  scope?: EnvScope
): Promise<EnvVariable[]> {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  log(`LIST ${projectRef}${scope ? ` scope=${scope}` : " (all scopes)"}`);
  const res = await envFetch(`/projects/${projectRef}/env${qs}`);
  const vars = await res.json() as EnvVariable[];
  log(`LIST ${projectRef} → ${vars.length} vars: ${vars.map(v => `${v.key}[${v.scope}]`).join(", ") || "(none)"}`);
  return vars;
}

export async function setRemoteVariable(
  projectRef: string,
  vars: Array<{ key: string; value: string; secret: boolean; scope?: EnvScope }>
): Promise<void> {
  for (const v of vars) {
    log(`SET ${projectRef} ${v.key} scope=${v.scope ?? "production"} caller=${new Error().stack?.split("\n")[2]?.trim() ?? "unknown"}`);
  }
  await Promise.all(
    vars.map((v) =>
      envFetch(`/projects/${projectRef}/env/${encodeURIComponent(v.key)}`, {
        method: "PUT",
        body: JSON.stringify({ value: v.value, secret: v.secret, scope: v.scope ?? "production" }),
      })
    )
  );
}

export async function deleteRemoteVariable(
  projectRef: string,
  key: string,
  scope: EnvScope = "production"
): Promise<void> {
  log(`DELETE ${projectRef} ${key} scope=${scope}`);
  const result = await envFetch(
    `/projects/${projectRef}/env/${encodeURIComponent(key)}?scope=${encodeURIComponent(scope)}`,
    { method: "DELETE" }
  );
  await result.text();
}

/**
 * Replace env vars for a set of keys across ALL scopes, then write the new values.
 * Use this instead of setRemoteVariable when re-adding a provider to avoid stale
 * entries from a previous scope (e.g. a production entry left over from before
 * scope-aware writes were introduced).
 */
export async function replaceRemoteVariables(
  projectRef: string,
  vars: Array<{ key: string; value: string; secret: boolean; scope: EnvScope }>
): Promise<void> {
  const keys = new Set(vars.map((v) => v.key));
  // Find all existing entries for these keys (any scope)
  const all = await listRemoteVariables(projectRef);
  const stale = all.filter((v) => keys.has(v.key));
  // Delete stale entries
  await Promise.allSettled(
    stale.map((v) => deleteRemoteVariable(projectRef, v.key, (v.scope ?? "production") as EnvScope))
  );
  // Write fresh
  await setRemoteVariable(projectRef, vars);
}

export async function clearRemoteScope(
  projectRef: string,
  scope: EnvScope
): Promise<void> {
  log(`CLEAR ${projectRef} scope=${scope}`);
  const vars = await listRemoteVariables(projectRef, scope);
  await Promise.allSettled(
    vars.map((v) => deleteRemoteVariable(projectRef, v.key, scope))
  );
}

export async function bulkPushVariables(
  projectRef: string,
  variables: EnvVariable[],
  options: { prune?: boolean } = {}
): Promise<{ pushed: number; deleted: number }> {
  await setRemoteVariable(projectRef, variables.map((v) => ({ ...v, scope: "production" as EnvScope })));
  let pushed = variables.length;
  let deleted = 0;

  if (options.prune) {
    const localKeys = new Set(variables.map((v) => v.key));
    const remoteVars = await listRemoteVariables(projectRef, "production");
    const toDelete = remoteVars.filter((v) => !localKeys.has(v.key));
    await Promise.all(toDelete.map((v) => deleteRemoteVariable(projectRef, v.key, "production")));
    deleted = toDelete.length;
  }

  return { pushed, deleted };
}

export function isPlatformVariable(_key: string): boolean {
  return false;
}

export function warnIfUnrecognisedPlatformVar(_key: string): string | null {
  return null;
}
