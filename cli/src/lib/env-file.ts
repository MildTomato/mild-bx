/**
 * Environment file parser and writer
 * Handles .env file parsing with @secret annotation support
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";
import type { EnvVariable, ParsedEnvFile } from "./env-types.js";

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
