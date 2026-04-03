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
  );

  -- Config snapshots keyed by (project_ref, git_branch, env_name).
  -- git_branch = the checked-out git branch when the snapshot was taken.
  -- env_name   = the config layer name derived from the config file
  --              (e.g. "production" from config.production.json, "preview" from config.preview.json).
  CREATE TABLE IF NOT EXISTS config_commits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_ref  TEXT NOT NULL,
    git_branch   TEXT NOT NULL,
    env_name     TEXT NOT NULL,
    committed_at TEXT NOT NULL DEFAULT (datetime('now')),
    config_json  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_config_commits_lookup
    ON config_commits(project_ref, git_branch, env_name, committed_at DESC);
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
  if (!validateScope(scope)) return c.json({ error: `Invalid scope '${scope}'` }, 400);
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

// ---------------------------------------------------------------------------
// Config storage — Git-like config snapshots per (project, git_branch, env_name)
//
// git_branch: the checked-out git branch when the snapshot was written
//   e.g. "main", "feat/my-feature"
//
// env_name: the config layer derived from the config filename
//   e.g. "production" (config.production.json), "preview" (config.preview.json),
//        "feat-auth" (config.feat-auth.json — branch overlay in preview env)
//
// This lets Studio answer: "if I merge feat/my-feature into main,
// how does the PRODUCTION config change?" — by diffing
//   feat/my-feature/production  vs  main/production
// ---------------------------------------------------------------------------

const CONFIG_HISTORY_LIMIT = 50;

/**
 * Flatten a nested object into dot-path → value pairs.
 * e.g. { auth: { site_url: "x" } } → { "auth.site_url": "x" }
 */
function flattenConfig(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenConfig(v, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

/**
 * Compute a field-level diff between two flat config objects.
 */
function diffFlatConfigs(from, to) {
  const added = [];
  const changed = [];
  const removed = [];

  for (const [path, toVal] of Object.entries(to)) {
    if (!(path in from)) {
      added.push({ path, value: toVal });
    } else if (JSON.stringify(from[path]) !== JSON.stringify(toVal)) {
      changed.push({ path, from: from[path], to: toVal });
    }
  }
  for (const path of Object.keys(from)) {
    if (!(path in to)) removed.push({ path, value: from[path] });
  }

  return { added, changed, removed };
}

// Commit a config snapshot for a git branch + env layer
// PUT /projects/:ref/config/:gitBranch/:envName
app.put("/projects/:ref/config/:gitBranch/:envName", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }
  const ref = c.req.param("ref");
  const gitBranch = decodeURIComponent(c.req.param("gitBranch"));
  const envName = decodeURIComponent(c.req.param("envName"));

  db.prepare(
    "INSERT INTO config_commits (project_ref, git_branch, env_name, config_json) VALUES (?, ?, ?, ?)"
  ).run(ref, gitBranch, envName, JSON.stringify(body));

  // Prune old commits — keep only the most recent CONFIG_HISTORY_LIMIT per (project, git_branch, env_name).
  db.prepare(`
    DELETE FROM config_commits
    WHERE project_ref = ? AND git_branch = ? AND env_name = ?
      AND id NOT IN (
        SELECT id FROM config_commits
        WHERE project_ref = ? AND git_branch = ? AND env_name = ?
        ORDER BY id DESC
        LIMIT ?
      )
  `).run(ref, gitBranch, envName, ref, gitBranch, envName, CONFIG_HISTORY_LIMIT);

  return c.json({ ok: true }, 201);
});

// Get all env snapshots for a git branch
// GET /projects/:ref/config/:gitBranch
app.get("/projects/:ref/config/:gitBranch", (c) => {
  const ref = c.req.param("ref");
  const gitBranch = decodeURIComponent(c.req.param("gitBranch"));
  const rows = db
    .prepare(
      "SELECT id, git_branch, env_name, committed_at, config_json FROM config_commits WHERE project_ref = ? AND git_branch = ? GROUP BY env_name HAVING id = MAX(id) ORDER BY env_name"
    )
    .all(ref, gitBranch);
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json(
    rows.map((r) => ({ id: r.id, gitBranch: r.git_branch, envName: r.env_name, committedAt: r.committed_at, config: JSON.parse(r.config_json) })),
    200
  );
});

// List all git branches that have config snapshots
// GET /projects/:ref/config
app.get("/projects/:ref/config", (c) => {
  const rows = db
    .prepare(
      "SELECT git_branch, MAX(committed_at) as last_committed_at, COUNT(DISTINCT env_name) as env_count FROM config_commits WHERE project_ref = ? GROUP BY git_branch ORDER BY last_committed_at DESC"
    )
    .all(c.req.param("ref"));
  return c.json(rows.map((r) => ({ gitBranch: r.git_branch, lastCommittedAt: r.last_committed_at, envCount: r.env_count })), 200);
});

// Diff the same env layer between two git branches
// GET /projects/:ref/config/diff?from=branch1&to=branch2&env=production
app.get("/projects/:ref/config/diff", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const env = c.req.query("env");
  if (!from || !to || !env) return c.json({ error: "from, to, and env query params required" }, 400);

  const ref = c.req.param("ref");
  const fromRow = db
    .prepare("SELECT config_json FROM config_commits WHERE project_ref = ? AND git_branch = ? AND env_name = ? ORDER BY id DESC LIMIT 1")
    .get(ref, from, env);
  const toRow = db
    .prepare("SELECT config_json FROM config_commits WHERE project_ref = ? AND git_branch = ? AND env_name = ? ORDER BY id DESC LIMIT 1")
    .get(ref, to, env);

  if (!fromRow) return c.json({ error: `No config found for branch '${from}' env '${env}'` }, 404);
  if (!toRow) return c.json({ error: `No config found for branch '${to}' env '${env}'` }, 404);

  const fromFlat = flattenConfig(JSON.parse(fromRow.config_json));
  const toFlat = flattenConfig(JSON.parse(toRow.config_json));
  const diff = diffFlatConfigs(fromFlat, toFlat);
  const hasChanges = diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;

  return c.json({ from, to, env, hasChanges, ...diff }, 200);
});

// Health check
app.get("/health", (c) => c.json({ ok: true }, 200));

const port = Number(process.env.ENV_SERVER_PORT ?? 3457);
console.log(`env-server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
