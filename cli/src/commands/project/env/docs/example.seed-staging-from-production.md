A common pattern when setting up a new staging environment:

```bash
supa project env create staging
supa project env seed staging --from production
supa project env set STRIPE_KEY "sk_staging_..." --environment staging --secret
```
