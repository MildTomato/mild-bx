#!/usr/bin/env node

/**
 * Find which table/column has an array default at position 28
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve("../examples/nextjs-demo/.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Import pg-delta to trigger its type parsers
await import("@supabase/pg-delta");

import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
const connectionString = `postgresql://postgres.dumltzfoaxseaekszcnt:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;

console.log("Finding all columns with their defaults...\n");
const pool = new pg.Pool({ connectionString });

// Use same query as pg-delta (simplified)
const result = await pool.query(`
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

let columnIndex = 0;
let foundProblem = false;

for (const row of result.rows) {
  const columns = row.columns;

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.default !== null) {
      const isArray = Array.isArray(col.default);
      if (isArray) {
        console.log(`[PROBLEM] Global column index ${columnIndex}`);
        console.log(`  Table: ${row.schema}.${row.name}`);
        console.log(`  Column: ${col.name} (position ${col.position})`);
        console.log(`  Default type: ARRAY`);
        console.log(`  Default value:`, col.default);
        console.log("");
        foundProblem = true;
      }

      // Check if this is column 28
      if (columnIndex === 28) {
        console.log(`Column 28:`);
        console.log(`  Table: ${row.schema}.${row.name}`);
        console.log(`  Column: ${col.name}`);
        console.log(`  Default type: ${typeof col.default}`);
        console.log(`  Default value:`, col.default);
        console.log("");
      }
    }
    columnIndex++;
  }
}

if (!foundProblem) {
  console.log("No array defaults found from Supabase side.");
  console.log("The problem must be from PGlite side.");
}

console.log(`Total columns checked: ${columnIndex}`);

await pool.end();
