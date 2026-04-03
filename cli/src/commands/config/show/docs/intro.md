Show the effective merged config for the current environment.

Loads `supabase/config.json` and any overlay files (`config.<env>.json`,
`config.<branch>.json`) and prints the merged result as JSON. Also shows
which files were loaded in the layers header.

Works offline — no authentication required.
