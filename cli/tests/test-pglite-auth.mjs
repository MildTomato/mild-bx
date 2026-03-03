#!/usr/bin/env node

/**
 * Test PGlite with auth schema seeded - find array defaults
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find auth migrations
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
    return { file, content };
  });
}

console.log("Creating PGlite with auth schema...\n");
const pglite = new PGlite();
await pglite.waitReady;

await pglite.query("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.query("CREATE SCHEMA IF NOT EXISTS extensions");

const migrations = loadAuthMigrations();
console.log(`Seeding ${migrations.length} auth migrations...`);

let migrationErrors = 0;
for (const { file, content } of migrations) {
  try {
    await pglite.exec(content); // Use exec() for multiple statements
  } catch (err) {
    migrationErrors++;
    if (
      !err.message.includes("CREATE EXTENSION") &&
      !err.message.includes("already exists")
    ) {
      console.log(`Migration error in ${file}: ${err.message.slice(0, 80)}`);
    }
  }
}
console.log(`Migration errors: ${migrationErrors}`);

// Also apply the demo schema
const schemaDir = join(
  __dirname,
  "../examples/nextjs-demo/supabase/schema/public",
);
if (existsSync(schemaDir)) {
  const files = readdirSync(schemaDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await pglite.exec(readFileSync(join(schemaDir, file), "utf-8"));
    } catch (err) {}
  }
}

// Check what tables exist
const tablesCheck = await pglite.query(`
  SELECT n.nspname as schema, c.relname as table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND NOT n.nspname LIKE 'pg_%'
    AND n.nspname != 'information_schema'
  ORDER BY n.nspname, c.relname
`);
console.log(`\nFound ${tablesCheck.rows.length} tables:`);
for (const t of tablesCheck.rows.slice(0, 10)) {
  console.log(`  ${t.schema}.${t.table}`);
}
if (tablesCheck.rows.length > 10) {
  console.log(`  ... and ${tablesCheck.rows.length - 10} more`);
}

console.log("\nQuerying columns with defaults...\n");

// Use same query as pg-delta
const result = await pglite.query(`
with extension_oids as (
  select objid
  from pg_depend d
  where d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
), tables as (
  select
    c.relnamespace::regnamespace::text as schema,
    quote_ident(c.relname) as name,
    c.oid as oid
  from pg_class c
  left join extension_oids e1 on c.oid = e1.objid
  where
    c.relkind in ('r', 'p')
    and not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
    and e1.objid is null
)
select
  t.schema,
  t.name,
  coalesce(json_agg(
    case when a.attname is not null then
      json_build_object(
        'name', a.attname,
        'position', a.attnum,
        'default', pg_get_expr(ad.adbin, ad.adrelid)
      )
    end
    order by a.attnum
  ) filter (where a.attname is not null), '[]') as columns
from
  tables t
  left join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on a.attrelid = ad.adrelid and a.attnum = ad.adnum
group by t.oid, t.schema, t.name
order by t.schema, t.name
`);

let foundProblem = false;

for (const row of result.rows) {
  const columns = row.columns;

  // Check tables with 29+ columns (to find column index 28)
  if (columns.length >= 29) {
    console.log(
      `\nTable with ${columns.length} columns: ${row.schema}.${row.name}`,
    );
    const col28 = columns[28];
    console.log(`  Column 28: ${col28.name}`);
    console.log(
      `  Default type: ${typeof col28.default} / isArray: ${Array.isArray(col28.default)}`,
    );
    console.log(`  Default value:`, col28.default);
  }

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const isArray = Array.isArray(col.default);
    if (isArray) {
      console.log(
        `[PROBLEM] ${row.schema}.${row.name}.${col.name} (index ${i})`,
      );
      console.log(`  Default is ARRAY:`, JSON.stringify(col.default));
      foundProblem = true;
    }
  }
}

if (!foundProblem) {
  console.log("\nNo array defaults found in PGlite!");
}

await pglite.close();
