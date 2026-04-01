# Multi-Env Design Doc — Codex Review

**Reviewer:** OpenAI Codex (consult mode, `model_reasoning_effort="medium"`)
**Date:** 2026-04-01
**Tokens:** 178,826

---

## Critical Issues

**Incompatible models.** You're mixing repo-authored overlays and platform-stored effective config. Once the platform stores only the merged result, `config set/unset --env` cannot "write only the delta" without reconstructing overlay intent you explicitly said the platform does not retain.

**Lossy pull.** `pull imports config.json only` breaks round-tripping. A user can push multi-environment config, then pull, and lose all non-base structure. That is not a sync model. It is a lossy export.

**Parentage not persisted.** Parent inheritance for custom environments is underspecified. `config.<env>.json` encodes overrides, but nowhere encodes the parent. If the platform stores only effective config, parentage disappears entirely.

**Vercel seeding ≠ live inheritance.** You are treating Vercel "import from another environment" as live inheritance. That is a bad assumption. Seeding is not ongoing inheritance.

**Branch names as filenames is brittle.** Real branch names contain `/`, `.`, uppercase, long strings, Unicode, and collisions after sanitization. `config.feat/a.json` is not a valid path scheme. `feat-a` the branch and `feat-a` the custom environment also collide.

**Arrays-replace semantics make branch deltas ugly.** Your own example proves it: a one-item branch change requires restating the full inherited array. Then `config set ...[3]=... --env current` is lying about "delta"; it has to materialize the whole array.

**`null` deletion sentinel is ambiguous.** Is `null` a deletion sentinel everywhere, or can a schema field legitimately be `null`? If both, you created ambiguity.

**Preview fan-out is hand-waved.** "all branches assigned to preview reconcile to it" conflicts with branch-specific overrides and current branch lifecycle reality. What happens when `config.preview.json` changes after 40 branch environments already exist with their own overrides?

**One-way ejection is not operationally defined.** What happens to existing repo overlay files for that env? Are pushes rejected? Ignored? Warned? Can one repo have mixed code-managed and dashboard-managed envs safely?

**`env(NAME)` resolution timing is unclear.** Do you validate before resolution, after resolution, or both? Missing vars, malformed placeholders, unresolved secrets, and wrong types need explicit failure behavior.

---

## Feasibility Risks

The repo today already shows the platform gap. Env propagation is currently a hack that pushes preview vars branch-by-branch because the platform does not resolve them natively. The design assumes platform-native effective per-environment config storage, revisioning, inheritance, and reconciliation that do not exist yet.

The current env var model is suffix-scoped names with precedence rules, not per-environment config overlays. This proposal adds a second abstraction layer instead of extending the one already in flight.

The repo's current workflow model is profile-based (`remote`, `local`, `branching-*`), not environment-overlay-file-based. This proposal adds a competing axis of complexity without saying which model wins.

Dashboard UX will be weak if it can only show effective config and never provenance. When something is wrong, users will ask "why is this enabled here?" and your model has no answer beyond reverse-diff guesswork.

---

## Missing Error Handling / Edge Cases

- No behavior for branch rename.
- No behavior for branch deletion beyond `env prune --dry-run` hand-waving.
- No behavior for file collisions after branch name sanitization.
- No behavior for unknown `--env current` when git is detached or outside a repo.
- No behavior for promotion when source/target parents differ.
- No behavior for promotion of secrets vs non-secrets.
- No behavior for partial sync failure: config uploaded, vars failed; vars uploaded, config failed.
- No behavior for schema evolution where a field moves/renames and old overlay files still target the old path.
- No behavior for concurrent edits from CLI, CI, and dashboard.
- No migration story from existing dashboard-managed multi-env projects except "pull one config.json," which is not a migration story.

---

## Overcomplexity

You have too many special cases at once: base, production override, preview override, branch override, custom env with parent, dashboard-managed mode, code-managed mode, one-way ejection, lossy pull, variable inheritance, promotion. This is not "simple with optional power." It is a state machine with many irrecoverable transitions.

**Simpler version:** keep `config.json` as the only config file, support per-environment variables with current scoped precedence, and maybe add exactly one optional `config.preview.json` later if there is proven demand. Skip custom env inheritance and dashboard/code ejection until the platform can actually persist provenance and revisions.
