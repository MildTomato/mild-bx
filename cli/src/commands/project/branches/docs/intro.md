Manage [database branches](https://supabase.com/docs/guides/platform/branching) for your Supabase project.

Database branches let you create isolated copies of your database schema for feature development, testing, and preview environments. Each branch gets its own project ref and can be tied to a git branch for automatic lifecycle management.

Use `supa branches create` to spin up a new branch (defaulting to the current git branch name), `supa branches update` to rename or re-associate a branch, and `supa branches delete` (or `rm`) to remove one when it is no longer needed.
