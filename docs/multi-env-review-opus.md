# Multi-Env Design Doc — Claude Opus Review

**Reviewer:** Claude Opus 4.6
**Date:** 2026-04-01

---

## Critical Issues

**Array replace semantics are a footgun with no mitigation.**
The doc acknowledges arrays replace (not append), then immediately shows an example where the user must manually restate all inherited redirect URLs in a branch override. This is the single most common source of config drift bugs. The doc waves at it ("important note") but proposes no tooling to help. `config set auth.additional_redirect_urls[3]=...` is positional indexing into a replaced array — what happens when the parent array changes length? The branch override silently becomes wrong. No solution is proposed.

**No definition of "environment" identity or lifecycle.**
The doc freely uses "environment" to mean: a platform-side entity, a file suffix, a branch name, a custom label, and a parent reference. There is no canonical definition of what creates an environment, what its lifecycle is, or how branch environments get cleaned up. `env prune --dry-run` is listed but its semantics are entirely undefined. When does a branch environment get created — on first push? On `config set --env current`? On branch creation in git? This is load-bearing and completely unstated.

**Sync trigger model is missing.**
The doc describes what sync does but never says when or how it happens. Is it manual (`supabase push`)? Automatic on git push via CI? Triggered by the platform on branch detection? All three? The answer changes the entire error model and consistency guarantees.

**Conflict resolution is absent.**
What happens when two developers push different `config.preview.json` changes to different branches that both merge? What happens when a dashboard-managed variable is set, then the same variable appears in a config file via `env(NAME)` — is that a conflict or not? What if `config.json` and `config.production.json` are updated in the same commit but only production sync succeeds?

**"Ejection is one-way" has no recovery story.**
If a user accidentally ejects, or if an org policy changes, there is no path back. The doc doesn't even mention this as a known limitation. One-way doors need explicit justification for why reversibility was rejected.

---

## Feasibility Risks

**`config set <path>=<value> --env <env>` requires a JSON patch engine that understands overlay semantics.**
Setting a value on a specific environment means the CLI must: load the full chain, determine which file the value should land in (the leaf overlay), compute the minimal diff against the parent chain, and write only that diff. This is non-trivial, especially with nested objects and the `null`-means-delete convention. No implementation sketch is provided.

**Fan-out reconciliation at scale.**
"All branches assigned to preview reconcile to it" — if a project has 50 active preview branches, updating `config.preview.json` triggers 50 effective config recomputations and uploads. What are the latency and rate-limit implications? Is this synchronous? Queued? Eventual?

**`--env current` depends on reliable branch detection.**
In CI environments (GitHub Actions, etc.), the current branch is not always trivially available (detached HEAD, merge commits, etc.). The doc assumes `current` resolves cleanly. It won't in common CI scenarios without explicit configuration.

---

## Missing Edge Cases

- Branch names with dots or special characters — `config.feat/auth-fix.json`, `config.dependabot/npm-lodash.json`?
- Branch name collides with reserved environment name — a branch named `production` or `preview`.
- Circular or conflicting inheritance — the doc says "exactly one parent" but doesn't prevent `staging` inheriting from `qa` inheriting from `staging`.
- Schema versioning — no mention of how config schema changes are handled across overlay files.
- Deletion semantics with `null` across three layers — if `config.preview.json` sets `"google": null`, and `config.feat-a.json` re-enables it, behavior is not defined.
- Empty overlay files — is `config.feat-a.json` with `{}` valid? Does it create an environment?
- Concurrent `push` from different branches modifying the same overlay.
- `env promote` semantics are entirely undefined — config? Variables? Both? Copy or re-point?

---

## Overcomplexity

**"Preview is special" inheritance is implicit magic.**
Branch overlays silently inherit from preview. Custom environments explicitly declare their parent. These are two different inheritance models in the same system. Pick one. Either everything declares its parent explicitly, or document clearly why branches are magic and custom environments are not.

**Four-layer merge depth for branch configs.**
`config.json -> config.preview.json -> config.feat-a.json` plus env var resolution. Users debugging "why does my branch have this value" must understand recursive object merge, array replacement, null deletion, and env var substitution across three files. The `config effective --env` command is essential but is listed as a nice-to-have CLI feature rather than a core debugging requirement.

**The pull model is artificially limited.**
"Pull imports config.json only" means users migrating an existing multi-environment project from dashboard to code get zero help. The doc says inferring overrides "is possible but should not be the default bootstrap path." Why not offer it as an explicit opt-in (`pull --with-overlays`)? The one-way ejection already makes migration painful; making import painful too means the transition story is bad in both directions.

---

## Verdict

The file overlay model and merge semantics are reasonable in isolation. The problems are all in the gaps: undefined lifecycle, unspecified sync triggers, no conflict model, dangerous array semantics with no tooling safety net, and two implicit inheritance models pretending to be one.

The design describes the happy path well but does not address the failure modes that will dominate real-world usage. It needs a second pass focused on: when environments are created/destroyed, how sync is triggered and what happens when it fails, how arrays are safely overridden, and explicit branch-name validation rules.

**`config effective --env` must be P0, not P1** — without it, this system is undebuggable.
