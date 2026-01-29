#!/usr/bin/env node

/**
 * Test our PGlite adapter with type transformations
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== Copy of our adapter code ==========

const TYPE_PARSERS = {
  22: (val) => {
    // int2vector
    if (!val || val === "") return [];
    return val.trim().split(/\s+/).map(Number);
  },
  20: (val) => BigInt(val), // bigint
  1002: (val) => parsePostgresArray(val), // char[]
  1009: (val) => parsePostgresArray(val), // text[]
  1015: (val) => parsePostgresArray(val), // varchar[]
  1005: (val) => parsePostgresArray(val).map(Number), // int2[]
  1007: (val) => parsePostgresArray(val).map(Number), // int4[]
  1016: (val) => parsePostgresArray(val).map(Number), // int8[]
};

function parsePostgresArray(value) {
  if (!value || value === "{}") return [];
  const inner = value.slice(1, -1);
  if (inner === "") return [];

  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
  return result;
}

function transformRowByFieldTypes(row, fields) {
  const result = { ...row };

  for (const field of fields) {
    const parser = TYPE_PARSERS[field.dataTypeID];
    if (
      parser &&
      result[field.name] != null &&
      typeof result[field.name] === "string"
    ) {
      try {
        result[field.name] = parser(result[field.name]);
      } catch {}
    }
  }

  return result;
}

function createPGlitePool(pglite) {
  return {
    async query(queryTextOrConfig, values) {
      let text =
        typeof queryTextOrConfig === "string"
          ? queryTextOrConfig
          : queryTextOrConfig.text;
      let params =
        typeof queryTextOrConfig === "string"
          ? values
          : queryTextOrConfig.values;

      const result = await pglite.query(text, params);

      // Transform rows based on field type OIDs
      const transformedRows = result.rows.map((row) =>
        transformRowByFieldTypes(row, result.fields),
      );

      return {
        rows: transformedRows,
        rowCount: result.rows.length,
        fields: result.fields,
        command: "",
        oid: 0,
      };
    },
    async connect() {
      return { query: this.query.bind(this), release: () => {} };
    },
    async end() {
      await pglite.close();
    },
  };
}

// ========== Test ==========

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

  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort()
    .map((file) => {
      let content = readFileSync(join(migrationsDir, file), "utf-8");
      content = content.replace(
        /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
        "auth",
      );
      return content;
    });
}

console.log("Creating PGlite...");
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

// Create our adapter
const pool = createPGlitePool(pglite);

// Run pg-delta's column query
const result = await pool.query(`
  SELECT 
    c.relnamespace::regnamespace::text as schema,
    quote_ident(c.relname) as name,
    coalesce(json_agg(
      case when a.attname is not null then
        json_build_object(
          'name', quote_ident(a.attname),
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

console.log(`\nFound ${result.rows.length} tables\n`);

// Check for array defaults
let foundProblem = false;
for (const row of result.rows) {
  for (let i = 0; i < row.columns.length; i++) {
    const col = row.columns[i];
    if (Array.isArray(col.default)) {
      console.log(
        `[PROBLEM] ${row.schema}.${row.name} column[${i}] ${col.name}:`,
      );
      console.log(`  default is ARRAY: ${JSON.stringify(col.default)}`);
      foundProblem = true;
    }
  }
}

if (!foundProblem) {
  console.log("No array defaults found through adapter!");
}

await pool.end();
