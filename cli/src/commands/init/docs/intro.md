Set up Supabase in the current directory.

Creates the `supabase/` folder structure. You can start with local development
(no account needed), connect to an existing project, or create a new one.

Run this once at the root of your repository to get started.

## What it does

1. Asks how you'd like to develop (local, connect existing, or create new)
2. Creates the `supabase/` directory structure
3. If connecting to the platform: configures your workflow profile and fetches project config

## Interactive flow

Running `supa init` starts with a gateway question:

```ansi
$ supa init

  ◆  How would you like to develop?
  │  ● Local development              No account needed, connect to cloud later
  │  ○ Connect to existing project    Link to a project on Supabase Platform
  │  ○ Create a new project           Set up a new project on Supabase Platform
  └
```

### Local development

Choosing "Local development" creates the project structure instantly — no
account or login required:

```ansi
  ✓ Initialized Supabase (local)

  Created in ./supabase/
    config.json
    schema/public/
    migrations/
    functions/
    types/

  Start writing SQL in supabase/schema/
  When you're ready to deploy, run supa init again to connect to the platform.
```

### Connecting to the platform

Choosing "Connect to existing project" or "Create a new project" walks you
through the full setup — organization, project, schema management, workflow
profile, and more.

If you previously ran `supa init` locally, running it again will detect the
existing project and offer to connect it to the platform.

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
