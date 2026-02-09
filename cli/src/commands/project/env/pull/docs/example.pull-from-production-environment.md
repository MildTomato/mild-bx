Useful for debugging production issues locally. Combine with
`--json` to pipe into other tools:

```bash
supa project env pull --environment production --json | jq '.variables'
```
