Set up Supabase in the current directory.

Creates the `supabase/` folder structure and links to a project. You can either
create a new project or connect to an existing one.

Run this once at the root of your repository to get started.

## What it does

1. Prompts you to select an organization and project
2. Creates the `supabase/` directory structure
3. Configures your workflow profile
4. Generates TypeScript types for your schema

## Interactive flow

Running `supa init` walks you through setup:

```ansi
$ supa init

  ◆  Select organization
  │  ● My Team
  │  ○ Personal
  └

  ◆  What would you like to do?
  │  ● Link to existing project
  │  ○ Create new project
  └

  ◆  Select project
  │  ● my-app (us-east-1)
  │  ○ staging-db (eu-west-1)
  └

  ◆  Select workflow profile
  │  ● solo     — Direct production deployments
  │  ○ staged   — Staging environment for testing
  │  ○ preview  — Isolated preview environments
  └

  ✓  Linked to project my-app

  Created:
    supabase/config.json
    supabase/schema/
    supabase/migrations/
    supabase/types/database.ts

  Your API credentials:
    URL:  https://abc123xyz.supabase.co
    Anon: eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

## Created files

After initialization, your project has this structure:

```
your-project/
├── supabase/
│   ├── config.json      # Project configuration
│   ├── schema/          # SQL schema files (synced with remote)
│   ├── migrations/      # Version-controlled migrations
│   └── types/
│       └── database.ts  # Generated TypeScript types
└── .env.local           # API credentials (if new project)
```
