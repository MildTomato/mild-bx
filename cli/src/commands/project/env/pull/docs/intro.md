<DemoVideo id="supa-project-env-pull" />

Fetches environment variables from the remote environment and writes
them to your local `supabase/.env` file. Secret variables are excluded
because they're write-only and can't be read back.

If `supabase/.env` already exists, you're prompted before overwriting
unless you pass `--yes`.
