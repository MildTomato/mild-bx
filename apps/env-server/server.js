import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "env.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS scopes (
    name TEXT PRIMARY KEY
  );

  INSERT OR IGNORE INTO scopes (name) VALUES
    ('production'),
    ('preview'),
    ('development'),
    ('config');

  CREATE TABLE IF NOT EXISTS env_vars (
    project_ref TEXT NOT NULL,
    key         TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'production' CHECK (scope IS NOT NULL),
    value       TEXT NOT NULL,
    secret      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_ref, key, scope),
    FOREIGN KEY (scope) REFERENCES scopes(name)
  )
`);


function validateScope(scope) {
  if (!scope) return false;
  if (scope.startsWith("branch:") && scope.length > 7) return true;
  return !!db.prepare("SELECT 1 FROM scopes WHERE name = ?").get(scope);
}

const app = new Hono();
app.use("*", cors());

// List all env vars for a project (optionally filtered by scope)
app.get("/projects/:ref/env", (c) => {
  const scope = c.req.query("scope");
  const vars = scope
    ? db.prepare("SELECT key, scope, value, secret FROM env_vars WHERE project_ref = ? AND scope = ?").all(c.req.param("ref"), scope)
    : db.prepare("SELECT key, scope, value, secret FROM env_vars WHERE project_ref = ?").all(c.req.param("ref"));
  return c.json(vars.map((v) => ({ ...v, secret: v.secret === 1 })), 200);
});

// Get a single env var by key + scope
app.get("/projects/:ref/env/:key", (c) => {
  const scope = c.req.query("scope") ?? "production";
  const row = db
    .prepare("SELECT key, scope, value, secret FROM env_vars WHERE project_ref = ? AND key = ? AND scope = ?")
    .get(c.req.param("ref"), c.req.param("key"), scope);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ ...row, secret: row.secret === 1 }, 200);
});

// Set (upsert) an env var
app.put("/projects/:ref/env/:key", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { value, secret = false, scope = "production" } = body;
  if (value === undefined) return c.json({ error: "Missing required field: value" }, 400);
  if (!scope) return c.json({ error: "scope cannot be null" }, 400);
  if (!validateScope(scope)) return c.json({ error: `Invalid scope '${scope}'. Must be 'production', 'preview', 'development', or 'branch:<name>'` }, 400);

  db.prepare(
    "INSERT INTO env_vars (project_ref, key, scope, value, secret) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_ref, key, scope) DO UPDATE SET value = excluded.value, secret = excluded.secret"
  ).run(c.req.param("ref"), c.req.param("key"), scope, value, secret ? 1 : 0);
  return c.json({ ok: true }, 200);
});

// Delete an env var by key + scope
app.delete("/projects/:ref/env/:key", async (c) => {
  const scope = c.req.query("scope") ?? "production";
  const result = db
    .prepare("DELETE FROM env_vars WHERE project_ref = ? AND key = ? AND scope = ?")
    .run(c.req.param("ref"), c.req.param("key"), scope);
  if (result.changes === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true }, 200);
});

// List valid scopes
app.get("/scopes", (c) => {
  const scopes = db.prepare("SELECT name FROM scopes").all().map((r) => r.name);
  return c.json(scopes, 200);
});

// Health check
app.get("/health", (c) => c.json({ ok: true }, 200));

const port = Number(process.env.ENV_SERVER_PORT ?? 3457);
console.log(`env-server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
