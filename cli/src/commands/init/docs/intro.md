<DemoVideo id="supa-init" />

Set up Supabase in the current directory.

Creates the `supabase/` folder structure. You can start with local development
(no account needed), connect to an existing project, or create a new one.

Run this once at the root of your repository to get started.

## Development modes

Run `supa init` and select how you'd like to develop.

### Connecting to the platform

Select "Connect to existing project" or "Create a new project" to link to
Supabase Platform. Both options walk you through organization, project,
schema management, and workflow profile selection.

<Tabs items={['Connect to existing', 'Create new project']}>
<Tab value="Connect to existing">

<DemoVideo id="supa-init--connect" />

</Tab>
<Tab value="Create new project">

<DemoVideo id="supa-init" />

</Tab>
</Tabs>

### Local development

Select "Local development" to scaffold the project structure without an
account. Run `supa init` again later to connect to the platform.

If you previously initialized locally, running `supa init` again offers to
connect the existing project.

<DemoVideo id="supa-init--local" />

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
