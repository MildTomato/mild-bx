#!/usr/bin/env node

/**
 * Check auth.users column 28 on PGlite with auth migrations
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find and load auth migrations
function findAuthMigrationsDir() {
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

function loadAuthMigrations() {
  const migrationsDir = findAuthMigrationsDir();
  if (!migrationsDir) return [];

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  return files.map((file) => {
    let content = readFileSync(join(migrationsDir, file), "utf-8");
    content = content.replace(
      /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
      "auth",
    );
    return content;
  });
}

console.log("Creating PGlite with auth migrations...\n");
const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions");

const migrations = loadAuthMigrations();
console.log(`Seeding ${migrations.length} migrations...`);

for (const migration of migrations) {
  try {
    await pglite.exec(migration);
  } catch (err) {}
}

// Check auth.users columns
const result = await pglite.query(`
  SELECT 
    a.attnum as position,
    a.attname as name,
    pg_get_expr(ad.adbin, ad.adrelid) as "default"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  WHERE n.nspname = 'auth' AND c.relname = 'users'
  ORDER BY a.attnum
`);

console.log(`\nauth.users has ${result.rows.length} columns on PGlite:\n`);

for (let i = 0; i < result.rows.length; i++) {
  const row = result.rows[i];
  const marker = i === 28 ? " <-- INDEX 28" : "";
  const defaultType = row.default
    ? Array.isArray(row.default)
      ? "ARRAY"
      : typeof row.default
    : "null";
  console.log(`[${i}] ${row.name}: default=${defaultType}${marker}`);
  if (row.default) {
    const val = Array.isArray(row.default)
      ? JSON.stringify(row.default)
      : String(row.default);
    console.log(`     value: ${val.slice(0, 60)}`);
  }
}

await pglite.close();
