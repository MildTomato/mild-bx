#!/usr/bin/env node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMigrationsDir() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "vendor", "supabase-auth", "migrations");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pglite = new PGlite();
await pglite.waitReady;

console.log("1. Creating schemas...");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth;");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions;");

console.log("2. Seeding auth migrations...");
const migrationsDir = findMigrationsDir();
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".up.sql"))
  .sort();

let authErrors = 0;
for (const file of migrations) {
  let content = readFileSync(join(migrationsDir, file), "utf-8");
  content = content.replace(
    /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
    "auth",
  );
  try {
    await pglite.exec(content);
  } catch (err) {
    authErrors++;
  }
}
console.log(
  `   Applied ${migrations.length - authErrors}/${migrations.length} auth migrations`,
);

// Check auth.users
const authCheck = await pglite.query(
  `SELECT COUNT(*) as count FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users'`,
);
console.log(`   auth.users exists: ${authCheck.rows[0].count > 0}`);

console.log("3. Applying schema files...");
const schemaDir = join(
  __dirname,
  "../examples/nextjs-demo/supabase/schema/public",
);
const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const content = readFileSync(join(schemaDir, file), "utf-8");
  try {
    await pglite.exec(content);
    console.log(`   ✓ ${file}`);
  } catch (err) {
    console.log(`   ✗ ${file}: ${err.message.slice(0, 80)}`);
  }
}

console.log("\n4. Checking tables and indexes...");
const tables = await pglite.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
);
console.log(`   Tables: ${tables.rows.map((r) => r.tablename).join(", ")}`);

const indexes = await pglite.query(
  `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
);
console.log(
  `   Indexes (${indexes.rows.length}): ${indexes.rows
    .slice(0, 5)
    .map((r) => r.indexname)
    .join(", ")}${indexes.rows.length > 5 ? "..." : ""}`,
);

await pglite.close();
