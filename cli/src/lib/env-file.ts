/**
 * Environment file parser and writer
 * Handles .env file parsing with @secret annotation support
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import type { EnvVariable, ParsedEnvFile } from "./env-types.js";
import { projectUrlFromDbHost } from "./env.js";

/**
 * Parse .env file content into structured format
 * Detects # @secret annotations on the line before a variable
 */
export function parseEnvFile(content: string): ParsedEnvFile {
  const lines = content.split("\n");
  const variables: EnvVariable[] = [];
  let header: string | undefined;
  let headerLines: string[] = [];
  let isSecret = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (line === "") {
      continue;
    }

    // Check for @secret annotation
    if (line === "# @secret") {
      isSecret = true;
      continue;
    }

    // Handle comments (collect as header until first variable)
    if (line.startsWith("#")) {
      if (variables.length === 0) {
        headerLines.push(line);
      }
      continue;
    }

    // Parse variable line (KEY=VALUE)
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*?)$/);
    if (match) {
      const [, key, rawValue] = match;
      let value = rawValue;

      // Handle quoted values
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
        // Unescape common escape sequences in double quotes
        if (rawValue.startsWith('"')) {
          value = value
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        }
      }

      variables.push({
        key,
        value,
        secret: isSecret,
      });

      isSecret = false; // Reset for next variable
    }
  }

  if (headerLines.length > 0) {
    header = headerLines.join("\n");
  }

  return { variables, header };
}

/**
 * Serialize variables to .env file format
 * Adds # @secret annotations for secret variables
 */
export function serializeEnvFile(
  variables: EnvVariable[],
  header?: string
): string {
  const lines: string[] = [];

  if (header) {
    lines.push(header);
    lines.push("");
  }

  for (const variable of variables) {
    // Add @secret annotation if needed
    if (variable.secret) {
      lines.push("# @secret");
    }

    // Escape value if it contains special characters
    let value = variable.value;
    const needsQuotes =
      value.includes(" ") ||
      value.includes("\n") ||
      value.includes("\t") ||
      value.includes('"') ||
      value.includes("'") ||
      value.includes("#") ||
      value === "";

    if (needsQuotes) {
      // Use double quotes and escape special characters
      value = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      value = `"${value}"`;
    }

    lines.push(`${variable.key}=${value}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Load environment variables from supabase/.env file
 */
export function loadLocalEnvVars(cwd: string): ParsedEnvFile {
  const envPath = path.join(cwd, "supabase", ".env");

  if (!fs.existsSync(envPath)) {
    return { variables: [] };
  }

  const content = fs.readFileSync(envPath, "utf-8");
  return parseEnvFile(content);
}

/**
 * Write environment variables to supabase/.env file atomically
 */
export function writeEnvFile(
  cwd: string,
  variables: EnvVariable[],
  header?: string
): void {
  const envPath = path.join(cwd, "supabase", ".env");
  const content = serializeEnvFile(variables, header);

  // Ensure supabase directory exists
  const supabaseDir = path.dirname(envPath);
  if (!fs.existsSync(supabaseDir)) {
    fs.mkdirSync(supabaseDir, { recursive: true });
  }

  writeFileAtomic(envPath, content);
}

/**
 * Heuristic to detect if a key name looks sensitive
 * Used to suggest default when prompting for secret marking
 */
export function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    upper.includes("SECRET") ||
    upper.includes("TOKEN") ||
    upper.includes("PASSWORD") ||
    upper.includes("API_KEY") ||
    upper.includes("APIKEY") ||
    upper.includes("PRIVATE_KEY") ||
    upper.includes("PRIVATEKEY") ||
    upper.includes("CREDENTIAL")
  );
}

/**
 * Inject local env vars into process.env for implicit binding.
 * Loads supabase/.env then supabase/.env.local.
 * Only sets vars not already present, so OS env always wins.
 */
export function injectLocalEnvVars(cwd: string): void {
  // Load supabase/.env first
  const envParsed = loadLocalEnvVars(cwd);
  for (const v of envParsed.variables) {
    if (process.env[v.key] === undefined) {
      process.env[v.key] = v.value;
    }
  }

  // Then load supabase/.env.local (overrides .env but not OS env)
  const envLocalPath = path.join(cwd, "supabase", ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const localContent = fs.readFileSync(envLocalPath, "utf-8");
    const localParsed = parseEnvFile(localContent);
    for (const v of localParsed.variables) {
      if (process.env[v.key] === undefined) {
        process.env[v.key] = v.value;
      }
    }
  }
}

/**
 * Resolve a variable from local environment
 * Resolution order: OS env > .env.local > .env (first match wins)
 */
export function resolveLocalVariable(
  key: string,
  cwd: string
): string | undefined {
  // 1. Check OS environment
  if (process.env[key] !== undefined) {
    return process.env[key];
  }

  // 2. Check .env.local
  const envLocalPath = path.join(cwd, "supabase", ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const localContent = fs.readFileSync(envLocalPath, "utf-8");
    const localParsed = parseEnvFile(localContent);
    const localVar = localParsed.variables.find((v) => v.key === key);
    if (localVar) {
      return localVar.value;
    }
  }

  // 3. Check .env
  const parsed = loadLocalEnvVars(cwd);
  const envVar = parsed.variables.find((v) => v.key === key);
  return envVar?.value;
}

/**
 * Upsert key=value pairs into a raw .env file string.
 * Lines that already start with `KEY=` are replaced in-place;
 * keys not yet present are appended at the end.
 */
function upsertEnvLines(
  content: string,
  updates: Record<string, string>
): string {
  const remaining = new Set(Object.keys(updates));
  const lines = content.split("\n");

  const updated = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && remaining.has(match[1])) {
      remaining.delete(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });

  // Append any keys that were not present in the existing file
  for (const key of remaining) {
    updated.push(`${key}=${updates[key]}`);
  }

  // Ensure a trailing newline
  const joined = updated.join("\n");
  return joined.endsWith("\n") ? joined : joined + "\n";
}

/**
 * Lazily import and instantiate the API client.
 * Avoids a circular dependency at module load time.
 */
async function getApiClient(token: string) {
  const { createClient } = await import("./api.js");
  return createClient(token);
}

/**
 * Fetch the anon key for a project. Returns undefined if not found or on error.
 */
async function fetchAnonKey(
  client: Awaited<ReturnType<typeof getApiClient>>,
  projectRef: string
): Promise<string | undefined> {
  try {
    const apiKeys = await client.getProjectApiKeys(projectRef, true);
    const anonEntry = apiKeys.find(
      (k) => k.name === "anon" || k.name === "publishable anon key"
    );
    return anonEntry?.api_key;
  } catch {
    // Non-fatal — caller skips writing the anon key lines
    return undefined;
  }
}

/**
 * Read <cwd>/.env.local (if it exists), upsert the given key=value pairs,
 * and atomically write the result back.
 */
async function upsertEnvLocal(
  cwd: string,
  updates: Record<string, string>
): Promise<void> {
  const envLocalPath = path.join(cwd, ".env.local");
  const existingContent = fs.existsSync(envLocalPath)
    ? fs.readFileSync(envLocalPath, "utf-8")
    : "";

  const newContent = upsertEnvLines(existingContent, updates);

  const envLocalDir = path.dirname(envLocalPath);
  if (!fs.existsSync(envLocalDir)) {
    fs.mkdirSync(envLocalDir, { recursive: true });
  }

  writeFileAtomic(envLocalPath, newContent);
}

/**
 * After a branch becomes healthy, fetch its DB password and write
 * credentials into supabase/.env.local so that subsequent CLI
 * operations (and the local Next.js app) use the right values.
 *
 * Returns the resolved `db_pass` so the caller can inject it into
 * `process.env` for the remainder of the current process.
 */
export async function writeBranchEnv(options: {
  cwd: string;
  branchRef: string;
  branchId: string;
  token: string;
  anonKey?: string;
}): Promise<string> {
  const { cwd, branchRef, branchId, token } = options;

  const client = await getApiClient(token);

  // 1. Fetch branch config to get db_host
  const branchConfig = await client.getBranchConfig(branchId);
  const supabaseUrl = projectUrlFromDbHost(branchConfig.db_host, branchRef);

  // 2. Always rotate the DB password — we have no JIT access so we own the
  //    password. Generate a fresh one every time and update the DB.
  const dbPass = crypto.randomBytes(16).toString("hex");
  await client.updateDatabasePassword(branchRef, dbPass);

  // 3. Resolve anon key
  const anonKey = options.anonKey ?? (await fetchAnonKey(client, branchRef));

  // 4. Build the upsert map
  const updates: Record<string, string> = {
    SUPABASE_DB_PASSWORD: dbPass,
    SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  };

  if (anonKey) {
    updates["SUPABASE_ANON_KEY"] = anonKey;
    updates["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = anonKey;
  }

  // 5. Upsert into .env.local
  await upsertEnvLocal(cwd, updates);

  // 6. Wait for Supabase to propagate the new password — must be after both
  //    the 200 from updateDatabasePassword and the .env.local write.
  await new Promise((r) => setTimeout(r, 5000));

  return dbPass;
}

/**
 * Write main-project credentials into <cwd>/.env.local.
 * Fetches the anon key from the API and reads SUPABASE_DB_PASSWORD from
 * process.env (which should already be populated from supabase/.env).
 * Non-fatal — errors are logged to stderr and the function resolves normally.
 */
export async function writeProjectEnv(options: {
  cwd: string;
  projectRef: string;
  token: string;
}): Promise<void> {
  const { cwd, projectRef, token } = options;

  // 1. Write the password immediately and unconditionally — we already have it
  //    in process.env regardless of whether the API calls below succeed.
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (dbPassword) {
    await upsertEnvLocal(cwd, { SUPABASE_DB_PASSWORD: dbPassword });
  }

  // 2. Best-effort: fetch project details and anon key, then upsert the URL
  //    and key variables.  A failure here is non-fatal — the password is
  //    already safely written above.
  try {
    const client = await getApiClient(token);

    const project = await client.getProject(projectRef);
    const anonKey = await fetchAnonKey(client, projectRef);

    const supabaseUrl = projectUrlFromDbHost(project.database.host, projectRef);
    const updates: Record<string, string> = {
      SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    };

    if (anonKey) {
      updates["SUPABASE_ANON_KEY"] = anonKey;
      updates["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = anonKey;
    }

    await upsertEnvLocal(cwd, updates);
  } catch (err) {
    process.stderr.write(
      `  [env] Failed to fetch project details for .env.local: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

}

/**
 * Resolve which Supabase branch corresponds to the current git branch,
 * write its credentials into supabase/.env.local, and inject SUPABASE_DB_PASSWORD
 * into the current process environment.
 *
 * Returns the resolved projectRef and whether it is a preview branch, or null
 * when no healthy branch could be matched.
 */
export async function resolveBranchAndWriteEnv(options: {
  cwd: string;
  gitBranch: string;
  mainProjectRef: string;
  token: string;
  productionBranch?: string;
}): Promise<{ projectRef: string; isBranch: boolean } | null> {
  const { cwd, gitBranch, mainProjectRef, token } = options;

  try {
    const client = await getApiClient(token);

    const branches = await client.listBranches(mainProjectRef);

    // Use the recorded production branch from config if available,
    // otherwise fall back to the conventional defaults.
    const productionBranch = options.productionBranch ?? "main";
    const isMain =
      gitBranch === productionBranch ||
      (!options.productionBranch && gitBranch === "master");

    if (isMain) {
      const defaultBranch = branches.find((b) => b.is_default);
      if (defaultBranch) {
        const dbPass = await writeBranchEnv({
          cwd,
          projectRef: mainProjectRef,
          branchId: defaultBranch.id,
          token,
        });
        process.env.SUPABASE_DB_PASSWORD = dbPass;
      }
      return { projectRef: mainProjectRef, isBranch: false };
    }

    // Feature branch
    const match = branches.find((b) => b.git_branch === gitBranch);
    if (!match) {
      return null;
    }

    if (match.preview_project_status !== "ACTIVE_HEALTHY") {
      return null;
    }

    const dbPass = await writeBranchEnv({
      cwd,
      projectRef: match.project_ref,
      branchId: match.id,
      token,
    });
    process.env.SUPABASE_DB_PASSWORD = dbPass;

    return { projectRef: match.project_ref, isBranch: true };
  } catch {
    return null;
  }
}
