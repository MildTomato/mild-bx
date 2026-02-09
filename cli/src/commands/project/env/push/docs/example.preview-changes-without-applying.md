Use dry run in a CI check step to catch unintended changes before
deploying:

```bash
# CI pipeline
supa project env push --dry-run --environment production --json
# exits 0 with a diff summary, no changes applied
```
