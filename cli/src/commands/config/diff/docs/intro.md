Show the field-level config difference between two branches.

Both branches must have had `supa push` run at some point — the diff is based on the config snapshots stored by the local env-server. This is useful before merging a feature branch to production, letting you review exactly which config values will change.
