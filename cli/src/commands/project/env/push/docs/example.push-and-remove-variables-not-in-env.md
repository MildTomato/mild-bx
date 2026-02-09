Without `--prune`, variables that exist remotely but not in your
local file are left untouched. With `--prune`, they're deleted so the
remote matches your local file exactly. Combine with `--dry-run`
first to review what would be removed:

```bash
supa project env push --prune --dry-run
```
