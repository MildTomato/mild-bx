Shows the three default environments plus any custom ones. Pass
`--json` to get machine-readable output for scripting:

```bash
supa project env list-environments --json | jq -r '.[].name'
```
