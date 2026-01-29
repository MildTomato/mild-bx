# Supabase CLI Skill

This skill helps you use the experimental Supabase DX CLI (`supa`) for managing Supabase projects.

## Overview

The `supa` CLI provides three main commands for syncing between local and remote Supabase environments:

- **`pull`** - Sync remote state to local (remote → local)
- **`push`** - Apply local changes to remote (local → remote)
- **`watch`** - Continuously monitor for changes

## Quick Start

```bash
# Login with your Supabase Personal Access Token
supa login

# Pull remote state (fetches project info, generates types)
supa pull

# Push local migrations to remote
supa push

# Start watch mode
supa watch
```

## Commands

### `supa login`

Authenticate with Supabase using a Personal Access Token.

```bash
supa login
# Enter your token when prompted

# Or use environment variable
export SUPABASE_ACCESS_TOKEN=sbp_xxx
```

Get a token at: https://supabase.com/dashboard/account/tokens

### `supa projects`

List all your Supabase projects.

```bash
supa projects

# JSON output for scripts
supa projects --json
```

### `supa pull`

Pull remote state to your local environment.

```bash
# Pull everything (project info, branches, types)
supa pull

# Only generate TypeScript types
supa pull --types-only

# Use specific profile
supa pull --profile staging

# Dry run (show what would happen)
supa pull --dry-run

# JSON output
supa pull --json
```

**What pull does:**

- Fetches project info from Supabase Management API
- Lists branches (if branching is enabled)
- Lists edge functions
- Generates TypeScript types → `supabase/types/database.ts`

### `supa push`

Push local changes to remote.

```bash
# Push all changes (shows plan, asks for confirmation)
supa push

# Auto-confirm (skip prompt)
supa push --yes

# Only push migrations
supa push --migrations-only

# Use specific profile
supa push --profile production

# Dry run
supa push --dry-run
```

**What push does:**

- Finds migration files in `supabase/migrations/`
- Applies migrations to remote database via Management API
- (Future) Deploys edge functions

### `supa watch`

Start watch mode for continuous development.

```bash
# Start watching
supa watch

# With specific profile
supa watch --profile local

# Custom types refresh interval
supa watch --types-interval 1m

# Disable git branch watching
supa watch --no-branch-watch
```

**What watch does:**

- Monitors git branch changes → auto-switches profile
- Regenerates TypeScript types periodically
- Outputs events as JSON (useful for VS Code extension)

## Global Flags

All commands support these flags:

| Flag        | Short | Description                                   |
| ----------- | ----- | --------------------------------------------- |
| `--profile` | `-p`  | Profile to use from `./supabase/config.toml`  |
| `--dry-run` |       | Show what would happen without making changes |
| `--json`    |       | Output as JSON (for scripts/extension)        |

## Configuration

The CLI reads configuration from `./supabase/config.toml`:

```toml
[project]
id = "abcdefghijklmnopqrst"  # Your Supabase project ref

[profiles.local]
mode = "local"
workflow = "dashboard"
branches = ["feature/*", "fix/*"]

[profiles.staging]
mode = "remote"
workflow = "git"
project = "staging-project-ref"  # Override project ref
branches = ["staging"]

[profiles.production]
mode = "remote"
workflow = "git"
branches = ["main"]
```

### Profile Options

| Option     | Values                       | Description                            |
| ---------- | ---------------------------- | -------------------------------------- |
| `mode`     | `local`, `preview`, `remote` | Development mode                       |
| `workflow` | `git`, `dashboard`           | How changes are managed                |
| `schema`   | `declarative`, `migrations`  | Schema management style                |
| `branches` | `["pattern/*"]`              | Git branch patterns for auto-selection |
| `project`  | `"ref"`                      | Override project ref for this profile  |

## Modes

### Local Mode (`mode = "local"`)

- Develop against local Supabase (via `supabase start`)
- Fast iteration, offline capable
- Use `workflow = "dashboard"` to capture schema changes

### Preview Mode (`mode = "preview"`)

- Use Supabase's preview branch feature
- Each git branch gets its own remote database
- Great for testing before merging

### Remote Mode (`mode = "remote"`)

- Connect directly to a remote Supabase project
- Use for staging/production environments
- Use `workflow = "git"` for CI/CD integration

## Git Integration

The CLI automatically detects your current git branch and selects a matching profile:

```toml
[profiles.local]
branches = ["feature/*", "fix/*"]  # Matches feature/auth, fix/bug-123, etc.

[profiles.staging]
branches = ["staging", "develop"]  # Exact matches
```

When you switch branches, `supa watch` will:

1. Detect the branch change
2. Find a matching profile
3. Switch context automatically

## Output Formats

### Human-Readable (default)

```
📥 Pull completed

  Profile:    local
  Project:    My App (abcdefghijklmnopqrst)
  Region:     us-east-1
  Status:     ACTIVE_HEALTHY

  Branches:   2
    * main
      develop

  Functions:  1
    - hello-world (v1)

  ✓ TypeScript types written to supabase/types/database.ts
```

### JSON (`--json`)

```json
{
  "status": "success",
  "profile": "local",
  "project_ref": "abcdefghijklmnopqrst",
  "project": {
    "name": "My App",
    "region": "us-east-1",
    "status": "ACTIVE_HEALTHY"
  },
  "branches": [...],
  "functions": [...],
  "types_written": true
}
```

## Examples

### Typical Development Flow

```bash
# 1. Start your day - pull latest state
supa pull

# 2. Work on your feature
# ... make database changes in dashboard ...

# 3. Generate types after schema changes
supa pull --types-only

# 4. Before committing - push migrations
supa push --dry-run  # Review first
supa push --yes      # Apply
```

### CI/CD Pipeline

```bash
# In GitHub Action
export SUPABASE_ACCESS_TOKEN=${{ secrets.SUPABASE_TOKEN }}

# Apply migrations to staging
supa push --profile staging --yes --json

# Generate types for type checking
supa pull --profile staging --types-only
```

### Switching Between Environments

```bash
# Work on feature branch (auto-selects local profile)
git checkout feature/new-auth
supa pull  # Uses local profile

# Switch to staging
git checkout staging
supa pull  # Uses staging profile

# Or explicitly specify
supa pull --profile production
```

## Troubleshooting

### "not logged in"

```bash
supa login
# Or set SUPABASE_ACCESS_TOKEN environment variable
```

### "no profiles configured"

Create `./supabase/config.toml` with at least one profile.

### "profile not found"

Check your profile name matches one in `config.toml`.

### "API error 401"

Your access token may be expired. Generate a new one and run `supa login` again.

## See Also

- [Supabase Workflows Skill](../supabase-workflows/SKILL.md) - Understanding git vs dashboard workflows
- [Supabase Management API](https://supabase.com/docs/reference/api/introduction)
- [Supabase CLI](https://supabase.com/docs/guides/cli) - Official CLI documentation
