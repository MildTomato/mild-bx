# Supabase Workflows Skill

This skill helps you understand and choose the right development workflow for Supabase projects.

## Overview

Supabase supports two primary workflows:

1. **Git Workflow** - Code-first, CI/CD integrated
2. **Dashboard Workflow** - GUI-first, capture changes later

Choose based on your team size, deployment needs, and preference.

## Git Workflow

### How It Works

```
Developer → Git Push → GitHub Action → Supabase Migration
```

1. Schema changes are written as migration files in `supabase/migrations/`
2. Push to GitHub triggers the Supabase GitHub integration
3. Migrations are automatically applied to your project
4. Preview branches create isolated database copies

### When to Use

- **Teams** - Multiple developers need to coordinate changes
- **Production** - Need reliable, repeatable deployments
- **CI/CD** - Want automated testing and deployment
- **Audit Trail** - Need history of all schema changes

### Setup

```toml
# supabase/config.toml
[profiles.staging]
mode = "remote"
workflow = "git"
branches = ["staging", "main"]
```

### Typical Flow

```bash
# 1. Create migration file
supabase migration new add_users_table

# 2. Edit the migration
# supabase/migrations/20240101120000_add_users_table.sql

# 3. Test locally
supabase db reset

# 4. Commit and push
git add supabase/migrations/
git commit -m "Add users table"
git push

# 5. GitHub integration applies to staging/production
```

### Best Practices

- **One migration per feature** - Keep changes atomic
- **Use descriptive names** - `add_user_roles` not `update_schema`
- **Include rollback** - Always plan for reverting
- **Test locally first** - Run `supabase db reset` before pushing

## Dashboard Workflow

### How It Works

```
Developer → Supabase Dashboard → db diff → Migration File
```

1. Make changes directly in Supabase Dashboard (Table Editor, SQL Editor)
2. Use `supabase db diff` to capture changes as a migration
3. Commit the generated migration to git
4. Optionally push to other environments

### When to Use

- **Prototyping** - Rapid iteration on schema design
- **Solo developers** - No coordination needed
- **Learning** - Visual feedback while exploring
- **Quick fixes** - Immediate changes needed

### Setup

```toml
# supabase/config.toml
[profiles.local]
mode = "local"
workflow = "dashboard"
branches = ["feature/*"]
```

### Typical Flow

```bash
# 1. Start local Supabase
supabase start

# 2. Make changes in Dashboard (localhost:54323)
# - Create tables
# - Add columns
# - Set up RLS policies

# 3. Capture changes
supabase db diff -f add_users_table

# 4. Review the generated migration
cat supabase/migrations/20240101120000_add_users_table.sql

# 5. Commit
git add supabase/migrations/
git commit -m "Add users table"
```

### Best Practices

- **Diff often** - Capture changes in small increments
- **Review diffs** - Always check generated SQL before committing
- **Name meaningfully** - Use `-f` flag with descriptive name
- **Reset and replay** - Verify migrations work from scratch

## Development Modes

### Local Mode

Run Supabase locally via Docker.

```toml
[profiles.local]
mode = "local"
```

**Pros:**

- Offline development
- Fast iteration
- No API limits
- Safe experimentation

**Cons:**

- Need Docker
- Data doesn't persist between `supabase stop`
- Different from production (versions, extensions)

**Commands:**

```bash
supabase start    # Start local stack
supabase stop     # Stop (data preserved)
supabase db reset # Reset database
```

### Preview Mode

Use Supabase's preview branches for isolated testing.

```toml
[profiles.preview]
mode = "preview"
branches = ["preview/*"]
```

**Pros:**

- Real Supabase environment
- Isolated per PR/branch
- Tests against production-like setup
- Automatic cleanup

**Cons:**

- Requires Pro plan (or higher)
- Network latency vs local
- Branch creation takes time

**How it works:**

1. Push to a branch
2. GitHub integration creates a Supabase branch
3. Branch has own database with your migrations
4. Merge PR → branch is deleted

### Remote Mode

Connect directly to a remote Supabase project.

```toml
[profiles.production]
mode = "remote"
project = "your-prod-project-ref"
branches = ["main"]
```

**Pros:**

- Real environment
- Shared team access
- Production data (careful!)

**Cons:**

- Changes affect real data
- API rate limits
- Network dependency

## Declarative vs Migration-Based Schema

### Migration-Based (Default)

Changes are defined as sequential SQL migrations.

```
supabase/migrations/
  20240101_create_users.sql
  20240102_add_email_to_users.sql
  20240103_create_posts.sql
```

**Pros:**

- Clear history of changes
- Easy to review in PRs
- Rollback capabilities
- Standard approach

### Declarative Schema

Define desired state in SQL files, generate migrations automatically.

```
supabase/schemas/
  public.sql     # Desired state of public schema
  auth.sql       # Auth schema customizations
```

```toml
[profiles.dev]
schema = "declarative"
```

**Pros:**

- See full schema at a glance
- No migration file management
- Easier for complex refactors

**Cons:**

- Need to run diff to generate migrations
- Less granular control
- Newer, less documented

**Usage:**

```bash
# Edit schema files
vim supabase/schemas/public.sql

# Generate migration from diff
supabase db diff -f update_schema

# Apply
supabase db reset
```

## Choosing Your Workflow

### Decision Tree

```
Are you on a team?
├── Yes → Use Git Workflow
│   ├── Need PR previews? → Enable Preview Branches
│   └── Just staging/prod? → Git workflow, remote mode
│
└── No (solo)
    ├── Prototyping? → Dashboard Workflow + Local Mode
    └── Production app? → Git Workflow + Remote Mode
```

### Hybrid Approach

Many teams use both:

1. **Local + Dashboard** for rapid prototyping
2. **Capture with db diff** when ready
3. **Git Workflow** for staging/production

```toml
[profiles.local]
mode = "local"
workflow = "dashboard"
branches = ["feature/*", "fix/*"]

[profiles.staging]
mode = "remote"
workflow = "git"
branches = ["staging"]

[profiles.production]
mode = "remote"
workflow = "git"
branches = ["main"]
```

## Common Patterns

### Feature Branch Development

```bash
# 1. Create feature branch
git checkout -b feature/user-auth

# 2. Start local
supabase start

# 3. Develop in dashboard
# ... make changes ...

# 4. Capture changes
supabase db diff -f add_auth_tables

# 5. Push for review
git add . && git commit -m "Add auth tables"
git push -u origin feature/user-auth

# 6. Create PR → Preview branch created
# 7. Merge → Applied to staging/production
```

### Hotfix to Production

```bash
# 1. Create hotfix migration
supabase migration new fix_rls_policy

# 2. Edit migration
# Add the fix SQL

# 3. Push directly to main (or via PR)
git checkout main
git pull
git add supabase/migrations/
git commit -m "Fix RLS policy"
git push

# Migration applied automatically
```

### Database Seeding

```bash
# Create seed file
# supabase/seed.sql
INSERT INTO users (email) VALUES ('admin@example.com');

# Apply after reset
supabase db reset  # Applies migrations + seed
```

## Environment Variables

```bash
# Authentication
SUPABASE_ACCESS_TOKEN=sbp_xxx

# Project reference (optional, prefer config.toml)
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst

# Database connection (for direct access)
SUPABASE_DB_URL=postgresql://...
```

## Troubleshooting

### "Migration failed"

- Check SQL syntax
- Ensure migrations are idempotent
- Look at Supabase dashboard logs

### "Preview branch not created"

- Verify GitHub integration is connected
- Check branch naming matches patterns
- Ensure Pro plan is active

### "db diff shows unexpected changes"

- Someone may have made dashboard changes
- Run `supabase db pull` to sync remote → local
- Review and commit the diff

### "Migrations out of sync"

- Compare `supabase_migrations.schema_migrations` table
- Use `supabase db push` to apply local migrations
- Or reset and reapply if in development

## See Also

- [Supabase CLI Skill](../supabase-cli/SKILL.md) - CLI command reference
- [Supabase Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [GitHub Integration](https://supabase.com/docs/guides/platform/branching)
