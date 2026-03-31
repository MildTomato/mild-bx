/**
 * Generates TypeScript types from the env-server database.
 * Run: node generate-types.js [output-path]
 *
 * Reads the scopes table and emits a EnvScope union type.
 * Default output: ../../cli/src/lib/env-server-types.ts
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "env.db"));

// Ensure schema exists (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS scopes (name TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO scopes (name) VALUES ('production'), ('preview'), ('development');
`);

const scopes = db.prepare("SELECT name FROM scopes ORDER BY name").all().map((r) => r.name);

if (scopes.length === 0) {
  console.error("No scopes found in DB — is the server initialised?");
  process.exit(1);
}

const union = scopes.map((s) => `"${s}"`).join(" | ");

const output = `// AUTO-GENERATED — do not edit manually.
// Run: node apps/env-server/generate-types.js
// Source: apps/env-server/env.db (scopes table)

export type EnvScope = ${union} | \`branch:\${string}\`;
`;

const outPath = resolve(
  process.argv[2] ?? join(__dirname, "../../cli/src/lib/env-server-types.ts")
);

writeFileSync(outPath, output, "utf-8");
console.log(`Generated ${outPath}`);
