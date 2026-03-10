#!/usr/bin/env node

/**
 * Test pg-delta's exact query on PGlite
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

console.log("Creating PGlite...\n");
const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions");

const migrations = loadAuthMigrations();
for (const migration of migrations) {
  try {
    await pglite.exec(migration);
  } catch {}
}

// Run pg-delta's EXACT column query structure
const result = await pglite.query(`
  SELECT 
    c.relnamespace::regnamespace::text as schema,
    quote_ident(c.relname) as name,
    coalesce(json_agg(
      case when a.attname is not null then
        json_build_object(
          'name', a.attname,
          'position', a.attnum,
          'data_type', a.atttypid::regtype::text,
          'not_null', a.attnotnull,
          'default', pg_get_expr(ad.adbin, ad.adrelid)
        )
      end
      order by a.attnum
    ) filter (where a.attname is not null), '[]') as columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname != 'information_schema'
  GROUP BY c.oid, c.relnamespace, c.relname
`);

console.log(`Found ${result.rows.length} tables\n`);

let foundArrayDefault = false;
for (const row of result.rows) {
  // Check for any column with array default
  for (let i = 0; i < row.columns.length; i++) {
    const col = row.columns[i];
    if (Array.isArray(col.default)) {
      console.log(
        `[PROBLEM] ${row.schema}.${row.name} column[${i}] ${col.name}:`,
      );
      console.log(`  default is ARRAY: ${JSON.stringify(col.default)}`);
      foundArrayDefault = true;
    }
  }

  // Also report tables with 29+ columns
  if (row.columns.length >= 29) {
    const col28 = row.columns[28];
    console.log(
      `Table ${row.schema}.${row.name} has ${row.columns.length} columns`,
    );
    console.log(
      `  Column 28: ${col28.name}, default type: ${typeof col28.default}`,
    );
  }
}

if (!foundArrayDefault) {
  console.log("No array defaults found in any table!");
}

await pglite.close();
