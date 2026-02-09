Once set, secret values are never returned by `list` or `pull`. Use
this for API keys, OAuth secrets, and other credentials. Reference
them in `supabase/config.json` with `env()` syntax:

```json
{
  "secret": "env(STRIPE_KEY)"
}
```
