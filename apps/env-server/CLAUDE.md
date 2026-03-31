# Env Server

The env-server is a **demo stand-in** for a platform-level environment variable service that does not yet exist on Supabase.

## What it simulates

On the real Supabase platform, environment variables would be stored per-project with scopes (`production`, `preview`, `development`, `branch:<ref>`). Any branch spun up under a project would automatically inherit and resolve the correct env vars for its scope.

This server simulates that behaviour locally using SQLite so the CLI can be demoed end-to-end without the real platform feature existing.

## Key rules

### Env vars are always stored under the parent project ref

All rows in `env_vars` use the **parent (production) project ref** as `project_ref` — never the branch ref. The branch ref is only used when making Supabase management API calls.

| project_ref         | key                                    | scope   |
|---------------------|----------------------------------------|---------|
| plgwxrdtjycuupfwqqfr | SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID | preview |
| plgwxrdtjycuupfwqqfr | SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET    | preview |

### Scopes

- `production` — production project only
- `preview` — all preview branches inherit this
- `branch:<ref>` — override for a specific branch ref
- `development` — local dev
- `config` — internal CLI config values (workflow_profile, schema_management, etc.)

### Auth provider add — what must happen

Because this is a demo, applying an auth provider on a preview branch requires TWO things, not one:

1. **Write env vars to env-server** under the parent ref with `preview` scope
2. **Apply auth config to every preview branch** via the management API — not just the current branch

Step 2 is necessary because the platform doesn't actually resolve env vars per-branch yet. Without pushing the config to every branch, other preview branches won't have the provider enabled. This is the core demo hack.

### Auth provider remove

Does NOT delete env vars from env-server. Cleanup is deferred to the merge/branch deletion lifecycle.

## Running the server

```bash
node apps/env-server/server.js
```

The SQLite database is at `apps/env-server/env.db`. Port 3457.
