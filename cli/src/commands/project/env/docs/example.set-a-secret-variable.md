Reference secrets in `supabase/config.json` with `env()` syntax.
The value is resolved at push time and never stored in version
control:

```json
{
  "secret": "env(STRIPE_KEY)"
}
```
