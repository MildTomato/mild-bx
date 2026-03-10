/**
 * Environment API bridge
 * Routes env commands to real APIs. Uses the secrets API as a bridge
 * for non-platform variables, and config APIs for platform variables.
 *
 * Key constraint: secrets API rejects names starting with `SUPABASE_`.
 * Platform variables (SUPABASE_AUTH_*, SUPABASE_API_*) go through their
 * respective config APIs.
 *
 * PROTOTYPE NOTE: The secrets API (/v1/projects/{ref}/secrets) is designed
 * for Edge Function secrets, not general project environment variables. We're
 * using it here as a temporary storage mechanism for the prototype because a
 * dedicated project env vars API doesn't exist yet. This needs to be replaced
 * with the real API once it's available on the platform.
 */
import type { SupabaseClient } from "./api.js";
import type { EnvVariable } from "./env-types.js";
import { isPlatformVar } from "@supabase-dx/env-vars";
import { parseScopedVarName } from "@supabase-dx/env-vars";

/**
 * Check if a key is a platform variable (routed to config APIs, not secrets API).
 * Strips scope suffix before checking so VAR__preview is treated same as VAR.
 */
export function isPlatformVariable(key: string): boolean {
  const { base } = parseScopedVarName(key);
  return isPlatformVar(base);
}

/**
 * Warn if a SUPABASE_* var is not in the platform registry.
 * These are likely typos or unsupported vars.
 */
export function warnIfUnrecognisedPlatformVar(key: string): string | null {
  const { base } = parseScopedVarName(key);
  if (base.startsWith("SUPABASE_") && !isPlatformVar(base)) {
    return `Warning: ${base} starts with SUPABASE_ but is not a recognised platform variable. Check the name is correct.`;
  }
  return null;
}

/**
 * List all remote variables from secrets API + config APIs
 */
export async function listRemoteVariables(
  client: SupabaseClient,
  projectRef: string
): Promise<EnvVariable[]> {
  const variables: EnvVariable[] = [];

  // PROTOTYPE: Using Edge Function secrets API as a stand-in for project env vars.
  const secrets = await client.listSecrets(projectRef);
  for (const s of secrets) {
    variables.push({
      key: s.name,
      value: s.value ?? "",
      secret: true,
    });
  }

  // Fetch auth config for SUPABASE_AUTH_* variables
  const authConfig = await client.getAuthConfig(projectRef);
  const authRecord = authConfig as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(authRecord)) {
    if (
      key.startsWith("external_") &&
      typeof value === "string" &&
      value !== ""
    ) {
      const canonicalKey = `SUPABASE_AUTH_${key.toUpperCase()}`;
      const isSecret = key.endsWith("_secret");
      variables.push({
        key: canonicalKey,
        value: isSecret ? "" : String(value),
        secret: isSecret,
      });
    }
  }

  return variables;
}

/**
 * Set a single remote variable
 */
export async function setRemoteVariable(
  client: SupabaseClient,
  projectRef: string,
  key: string,
  value: string,
  secret: boolean
): Promise<void> {
  if (isPlatformVariable(key)) {
    // Route through config APIs
    if (key.startsWith("SUPABASE_AUTH_")) {
      const authKey = key.replace("SUPABASE_AUTH_", "").toLowerCase();
      await client.updateAuthConfig(projectRef, {
        [authKey]: value,
      } as Record<string, unknown>);
    } else if (key.startsWith("SUPABASE_API_")) {
      const apiKey = key.replace("SUPABASE_API_", "").toLowerCase();
      await client.updatePostgrestConfig(projectRef, {
        [apiKey]: value,
      } as Record<string, unknown>);
    }
  } else {
    // PROTOTYPE: Using Edge Function secrets API as a stand-in for project env vars.
    await client.createSecrets(projectRef, [{ name: key, value }]);
  }
}

/**
 * Delete a single remote variable
 */
export async function deleteRemoteVariable(
  client: SupabaseClient,
  projectRef: string,
  key: string
): Promise<void> {
  if (isPlatformVariable(key)) {
    // Platform variables can be unset by setting empty string
    if (key.startsWith("SUPABASE_AUTH_")) {
      const authKey = key.replace("SUPABASE_AUTH_", "").toLowerCase();
      await client.updateAuthConfig(projectRef, {
        [authKey]: "",
      } as Record<string, unknown>);
    }
  } else {
    await client.deleteSecrets(projectRef, [key]);
  }
}

/**
 * Bulk push variables to remote
 */
export async function bulkPushVariables(
  client: SupabaseClient,
  projectRef: string,
  variables: EnvVariable[],
  options: { prune?: boolean } = {}
): Promise<{ pushed: number; deleted: number }> {
  let pushed = 0;
  let deleted = 0;

  // Split into platform and non-platform variables
  const platformVars = variables.filter((v) => isPlatformVariable(v.key));
  const secretVars = variables.filter((v) => !isPlatformVariable(v.key));

  // PROTOTYPE: Using Edge Function secrets API as a stand-in for project env vars.
  if (secretVars.length > 0) {
    const secretPayload = secretVars.map((v) => ({
      name: v.key,
      value: v.value,
    }));
    await client.createSecrets(projectRef, secretPayload);
    pushed += secretVars.length;
  }

  // Push platform variables via config APIs
  for (const v of platformVars) {
    await setRemoteVariable(client, projectRef, v.key, v.value, v.secret);
    pushed++;
  }

  // Handle prune: delete remote vars not in the local list
  if (options.prune) {
    const localKeys = new Set(variables.map((v) => v.key));
    const remoteVars = await listRemoteVariables(client, projectRef);
    const toDelete = remoteVars.filter((v) => !localKeys.has(v.key));

    for (const v of toDelete) {
      await deleteRemoteVariable(client, projectRef, v.key);
      deleted++;
    }
  }

  return { pushed, deleted };
}
