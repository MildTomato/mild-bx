<DemoVideo id="supa-project-env-push" />

Reads your local `supabase/.env` file, computes a diff against the
remote environment, and applies the changes. You see a summary of
additions, updates, and deletions before confirming.

By default, variables that exist remotely but aren't in your local
file are left untouched. Pass `--prune` to remove them.
