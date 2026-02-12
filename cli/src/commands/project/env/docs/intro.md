<DemoVideo id="supa-project-env" />

The `supa project env` commands let you store, sync, and manage environment
variables for your Supabase project without using the dashboard. Variables
are scoped to environments (development, preview, production, or custom)
and can have branch-level overrides.

## Features

The env subsystem covers the full lifecycle of environment variables:

- **Pull and push workflow**: Sync variables between your local `.env`
  file and remote environments
- **Secret management**: Mark variables as write-only secrets that are
  never exposed in reads
- **Branch overrides**: Set per-branch variable values for preview
  environments
- **Environment seeding**: Copy variables from one environment to another
- **Custom environments**: Create additional environments beyond the
  three defaults

## Quick start

Get started with the most common operations:

```bash
# List variables in development
supa project env list

# Set a variable
supa project env set API_KEY "sk_test_123"

# Set a secret (write-only, never returned in reads)
supa project env set STRIPE_KEY "sk_live_456" --secret

# Pull remote variables to local .env
supa project env pull

# Push local .env to remote
supa project env push

# List all environments
supa project env list-environments
```

## How it works

Environment variables are stored remotely per-environment. The local
`supabase/.env` file acts as the working copy for pull and push
operations.

- **`env pull`** fetches non-secret variables into `supabase/.env`
- **`env push`** computes a diff and uploads `supabase/.env` to the
  remote environment
- **`env set`** and **`env unset`** modify individual variables directly
  on the remote
- Secret variables are write-only and can never be read back

Sensitive fields in `supabase/config.json` use `env()` references
(for example, `"secret": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`)
that resolve at push time. See
[auth-provider](/docs/cli/reference/project/auth-provider) for details
on how secrets are stored.

### Branch overrides

For preview environments, you can set branch-specific variable values:

```bash
supa project env set DEBUG "true" --branch feature-x
```

Branch overrides take precedence over the base environment value when
that branch is active.

## Local files

These files live in your `supabase/` directory:

| File | Purpose |
|------|---------|
| `.env` | Working copy for pull and push (add to `.gitignore`) |
| `.env.local` | Local-only overrides, never pushed to remote |

## Next steps

- Set a variable: `supa project env set API_KEY "value"`
- Pull variables from remote:
  `supa project env pull --environment production`
- View all options: `supa project env --help`
