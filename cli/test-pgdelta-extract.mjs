#!/usr/bin/env node

/**
 * Test pg-delta's actual extractTables function
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env
const envPath = resolve("../examples/nextjs-demo/.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

// Import after pg-delta is loaded (triggers type parsers)
const pgDelta = await import("@supabase/pg-delta");

// Create PGlite pool adapter
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
      return {
        rows: result.rows,
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

// Test with Supabase
const password = process.env.SUPABASE_DB_PASSWORD;
const connectionString = `postgresql://postgres.dumltzfoaxseaekszcnt:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;

console.log("Testing pg-delta createPlan...\n");

// Create simple PGlite with test table
const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec(`
  CREATE TABLE test (
    id serial PRIMARY KEY,
    name text
  );
`);

const pglitePool = createPGlitePool(pglite);
const supabasePool = new pg.Pool({ connectionString });

try {
  console.log("Calling createPlan...");
  const plan = await pgDelta.createPlan(supabasePool, pglitePool, {
    filter: { schema: "public" },
  });
  console.log("Success!");
  console.log("Changes:", plan.changes?.length || 0);
} catch (err) {
  console.log("Error:", err.message);
  if (err.errors) {
    console.log("Zod errors:", JSON.stringify(err.errors, null, 2));
  }
}

await supabasePool.end();
await pglitePool.end();
