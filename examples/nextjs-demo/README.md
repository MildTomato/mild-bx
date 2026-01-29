# Next.js + Supabase Demo

Example Next.js app with Supabase DX CLI integration.

## Setup

1. **Create a Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard)

2. **Update config** - Edit `supabase/config.toml` and replace `your-project-ref` with your project reference ID

3. **Login to CLI**:

   ```bash
   supa-demo login
   ```

4. **Pull project state**:

   ```bash
   supa-demo pull
   ```

   This will:
   - Fetch project info
   - Generate TypeScript types to `supabase/types/database.ts`

5. **Push migrations** (when ready):
   ```bash
   supa-demo push --dry-run  # Preview changes
   supa-demo push            # Apply to remote
   ```

## Directory Structure

```
supabase/
├── config.json              # CLI config with JSON Schema (IDE autocompletion!)
├── migrations/              # Database migrations
│   ├── 20240101000000_create_users.sql
│   └── 20240102000000_create_posts.sql
├── functions/               # Edge Functions
│   └── hello-world/
│       └── index.ts
└── types/                   # Generated types (after pull)
    └── database.ts
```

## Config with JSON Schema

The `config.json` file uses JSON Schema for IDE autocompletion:

```json
{
  "$schema": "../../../external/config-schema/dist/schema.json",
  "project_id": "your-project-ref",
  "profiles": {
    "local": {
      "mode": "local",
      "branches": ["feature/*"]
    }
  }
}
```

Your IDE will provide:

- Autocompletion for all Supabase config fields
- Descriptions and documentation inline
- Validation as you type

## Profiles

The config defines three profiles:

- **local** - For feature/fix branches, uses local Supabase
- **staging** - For staging branch, connects to staging project
- **production** - For main branch, connects to production

The CLI auto-selects profile based on your git branch.

## Commands

```bash
supa-demo pull              # Sync remote → local
supa-demo push              # Apply local → remote
supa-demo watch             # Watch for changes
supa-demo projects          # List projects
```

## Development

```bash
pnpm dev                    # Start Next.js dev server
supa-demo watch             # Watch for branch changes, regenerate types
```
