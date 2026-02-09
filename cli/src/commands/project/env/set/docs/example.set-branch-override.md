Branch overrides let you test different config per feature branch
without affecting the base environment. When the branch is merged
or deleted, clean up the override with `unset --branch`:

```bash
supa project env unset DEBUG --branch feature-x
```
