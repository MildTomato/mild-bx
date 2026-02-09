Run this after cloning a project to bootstrap your local environment:

```bash
git clone <repo> && cd <repo>
supa project env pull
```

The resulting `supabase/.env` file looks like:

```
API_KEY=sk_test_123
DATABASE_URL=postgresql://...
```

Add `supabase/.env` to `.gitignore` to avoid committing secrets.
