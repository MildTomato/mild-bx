Output shows variable names and values in a table. Secrets display
as `••••••••` since they're write-only. Pass `--json` to get
structured output for scripting:

```bash
supa project env list --json | jq -r '.[].key'
```
