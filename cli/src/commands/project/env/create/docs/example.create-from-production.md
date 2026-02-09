Copies all non-secret variables from production. Secret variables
(like API keys) are write-only and must be set separately on the new
environment:

```bash
supa project env create staging --from production
supa project env set STRIPE_KEY "sk_staging_..." --environment staging --secret
```
