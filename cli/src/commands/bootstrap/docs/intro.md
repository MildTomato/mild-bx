<DemoVideo id="supa-bootstrap" />

Bootstrap a new project from a starter template. This command downloads a
template from the Supabase community samples repository, creates a new
Supabase project, waits for it to be ready, pushes any included migrations,
and writes a `.env` file with your project credentials.

## Interactive flow

When run without arguments, `supa bootstrap` walks you through an interactive
flow:

1. **Template selection** -- pick from community starter templates or start
   from scratch
2. **Authentication** -- logs you in if needed
3. **Project creation** -- choose an org, name your project, pick a region
4. **Wait for ready** -- polls until the database and connection pooler are
   healthy
5. **Push migrations** -- applies any `.sql` files found in
   `supabase/migrations/`
6. **Write `.env`** -- generates a `.env` file with your API keys and
   database connection strings, merging with `.env.example` if present

## Created files

| File | Description |
|------|-------------|
| `supabase/config.json` | Project configuration linked to your cloud project |
| `supabase/migrations/` | Database migration files (from the template) |
| `.env` | Environment variables with API keys and database URLs |
