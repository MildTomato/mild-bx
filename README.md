# Supabase BX

Experimental ideas for Supabase Builder Experience. This monorepo
contains prototypes for a next-generation CLI, a declarative
authorization system, and a documentation site.

> **Note:** This is a preview feature currently under active
> development.

## What's inside

### CLI (`cli/`)

The `supa` CLI manages Supabase projects from the terminal. It
provides declarative schema sync, environment management, and
workflow profiles that adapt to how your team deploys.

- **Schema sync** — Write SQL in `supabase/schema/`, and the CLI
  diffs it against your remote database and generates migrations
  automatically. No manual migration files to manage.
- **Push and pull** — `supa project push` deploys local changes to
  remote. `supa project pull` fetches remote state to local. Both
  support `--plan` for a dry-run preview.
- **Dev mode** — `supa dev` watches for file changes and continuously
  syncs schema, generates TypeScript types, and runs seeds.
- **Workflow profiles** — Choose between `solo`, `staged`, `preview`,
  and `preview-git` deployments. The CLI auto-selects a profile based
  on your current git branch.
- **Config as code** — API settings, auth providers, and storage
  policies live in `supabase/config.json` and can be diffed, synced,
  and version-controlled.
- **Bootstrap** — `supa bootstrap` scaffolds a project from starter
  templates with an interactive picker.

### Auth Rules (`auth-rules-sql/`)

A declarative authorization layer for Supabase that replaces
hand-written RLS policies with a SQL-based DSL.

- **Claims** describe what users have access to (their orgs, teams,
  roles).
- **Rules** describe what data users can read, create, update, or
  delete — including column-level control.
- Works transparently with existing Supabase client code. No client
  changes required.

```sql
-- Define a claim: which orgs does each user belong to?
SELECT auth_rules.claim('org_ids', $$
  SELECT user_id, org_id FROM org_members
$$);

-- Define a rule: users can read documents in their orgs
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

### Docs site (`apps/docs/`)

A Next.js documentation site built with Fumadocs. Covers Auth Rules,
CLI usage, workflow profiles, configuration reference, and schema
sync. CLI reference pages are auto-generated from command specs.

## Project structure

```
cli/               CLI application (TypeScript, Ink)
auth-rules-sql/    Auth Rules SQL implementation and docs
apps/docs/         Documentation site (Next.js, Fumadocs)
docs/              Architecture notes
skills/            AI agent skills
```

## Development

```bash
pnpm install   # Install dependencies
pnpm build     # Build everything
pnpm dev       # Watch mode (CLI)
```

See the [CLI development guide](apps/docs/content/docs/cli/development.mdx)
for details on adding commands, running tests, and project
conventions.
