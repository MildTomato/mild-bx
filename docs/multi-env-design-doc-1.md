Summary

This model supports both simple single-file config and richer multi-environment config without forcing either style:

config.json is the shared base config.

config.production.json is an optional production-only override.

config.preview.json is an optional shared preview override.

config.<branch>.json is an optional branch-specific override.

Custom environments can optionally inherit from exactly one parent environment.

Environment variables are stored per platform environment and resolve env(NAME) placeholders in config.

The platform and dashboard store effective per-environment config, not overlay files.

Ejection from code-managed to dashboard-managed is one-way.

pull imports config.json only.

This means users can choose either:

Single-file mode

only config.json

no other files required

Multi-environment mode

config.json plus one or more environment override files

Extra files only ever define overrides. If they do not exist, config.json remains enough.

This follows the same direction as Vercel’s environment model:

Vercel says non-production branches are preview by default: “all the Git branches that are not main are considered preview branches.” (Vercel Git docs)

Vercel says branch-specific preview vars override shared preview vars: “Any branch-specific variables will override” preview vars with the same name. (Vercel Environment Variables docs)

Vercel custom environments can be created by importing variables from another environment. (Vercel Environments docs)

File Model

Repo files live side by side:

supabase/config.json

supabase/config.production.json

supabase/config.preview.json

supabase/config.staging.json

supabase/config.feat-a.json

Rules:

config.json is always the shared base.

config.<env>.json is always an optional sparse override.

Overlay files never define a project on their own.

Overlay files should contain only differences, not full copies.

Users who do not care about multiple environments can use only config.json.

Recommended merge semantics:

objects merge recursively

scalars replace

arrays replace

null deletes inherited values

Effective Config Resolution

Production

Effective production config is:

config.json

then config.production.json if present

This means production can be either:

just config.json

or config.json plus a production-only override

Shared Preview

Effective shared preview config is:

config.json

then config.preview.json

Preview does not inherit config.production.json.

Preview Branch

If feat-a is a normal preview branch, effective config is:

config.json

then config.preview.json

then config.feat-a.json

This makes preview special in a practical way: branch-specific preview config inherits preview by default.

Custom Environment

If a custom environment staging inherits from preview, effective config is:

config.json

then config.preview.json

then config.staging.json

If staging inherits from production, effective config is:

config.json

then config.production.json if present

then config.staging.json

Why config.production.json Helps

Allowing config.production.json avoids an awkward pattern where production-only behavior would otherwise need to live in config.json, forcing every other environment to explicitly disable it.

This is especially useful when something should exist only in production.

Examples:

stricter auth behavior only in prod

a production-only provider

production-only redirect URLs

production-only feature enablement

At the same time, users who do not need that flexibility can ignore config.production.json entirely and stay on a single config.json.

That keeps the model scalable without making it heavy.

Why Preview Should Be Special

Yes, preview should still be special.

Reason:

preview is the common non-production environment

most short-lived branches should inherit the same preview defaults

branch-only overrides should be incremental, not full copies

This mirrors Vercel’s mental model:

preview is the default target for non-production branches (Vercel Git docs)

branch-specific preview vars only override the shared preview defaults rather than replacing them wholesale (Vercel Environment Variables docs)

That leads to the most natural DX:

shared defaults go in config.json

prod-only changes go in config.production.json

shared preview changes go in config.preview.json

one-off branch changes go in config.<branch>.json

Auth Example: Production Social Login, Preview Email/Password Only

A clear real-world example is auth behavior that intentionally differs between prod and preview.

Goal:

production allows Google login

preview disables Google login and only allows email/password signup

preview also uses different auth.site_url and auth.additional_redirect_urls

Shared base in config.json

{
"auth": {
"site_url": "https://app.example.com",
"additional_redirect_urls": [],
"email": {
"enable_signup": false,
"enable_confirmations": true
},
"external": {
"google": {
"enabled": false
}
}
}
}

Interpretation:

base config is conservative and shared

no provider is enabled by default

shared defaults remain valid even if no extra file exists

Production override in config.production.json

{
"auth": {
"additional_redirect_urls": [
"https://app.example.com/auth/callback"
],
"external": {
"google": {
"enabled": true,
"client_id": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)",
"secret": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
}
}
}
}

Interpretation:

production enables Google login

production keeps email signup disabled

production adds its production callback URL

The provider shape and env-based secret handling align with the Supabase CLI config docs for auth.external.<provider> and provider secrets. (Supabase CLI config docs)

Shared preview override in config.preview.json

{
"auth": {
"site_url": "https://preview.example.com",
"additional_redirect_urls": [
"http://localhost:3000/**",
"https://*-acme-team.vercel.app/**",
"https://preview.example.com/auth/callback"
],
"email": {
"enable_signup": true,
"enable_confirmations": false
},
"external": {
"google": {
"enabled": false
}
}
}
}

Interpretation:

preview disables Google login

preview enables email/password signup for QA and test accounts

preview changes site_url

preview expands allowed redirects to support local dev and preview deployments

This is consistent with Supabase’s guidance that auth.site_url defines the default redirect target and auth.additional_redirect_urls should include preview and local URLs, including Vercel preview patterns such as https://\*-<team-or-account-slug>.vercel.app/\*\*. (Supabase Redirect URLs docs, Supabase CLI config docs)

Effective outcome

production uses shared base plus production override and allows Google login

preview uses shared base plus preview override and allows email/password only

That is a strong example of why both config.production.json and config.preview.json are useful: they express deliberate environment-specific auth policy without forcing each environment to undo another’s choices.

Branch-Only Example: Extra Redirect URL for a One-Off Preview Branch

For a branch-specific overlay, use something meaningful that is not already part of the shared preview policy.

Example goal:

branch feat-a is testing a dedicated preview URL for a partner demo

it needs one extra allowed redirect URL beyond the shared preview list

Branch override in config.feat-a.json

{
"auth": {
"additional_redirect_urls": [
"http://localhost:3000/**",
"https://*-acme-team.vercel.app/**",
"https://preview.example.com/auth/callback",
"https://feat-a-demo.example.com/auth/callback"
]
}
}

Interpretation:

feat-a inherits preview auth behavior

it keeps the shared preview redirect list

it adds one branch-only callback URL for a temporary hosted demo

This is meaningful because auth.additional_redirect_urls is exactly the setting Supabase documents for allowing post-auth redirects, and branch-only URLs are a realistic reason to use a one-off overlay. (Supabase CLI config docs, Supabase Redirect URLs docs)

Important note:

because arrays replace rather than append, the branch override must restate the inherited preview redirect URLs as well as the new branch-only URL

Environment Variables

Environment variables are part of the environment model, but separate from config files.

Recommended split:

config files: non-secret, reviewable, structural differences

environment variables: secrets and operational values

Config files should be able to reference variables with placeholders like:

env(AUTH_JWT_SECRET)

At runtime, those placeholders resolve against the active platform environment’s variable store.

Example

config.json:

{
"auth": {
"jwt_secret": "env(AUTH_JWT_SECRET)"
}
}

config.production.json:

{
"auth": {
"external": {
"google": {
"client_id": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)",
"secret": "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
}
}
}
}

Platform variable stores:

production

AUTH_JWT_SECRET=prod-secret

SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=prod-google-client-id

SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=prod-google-secret

preview

AUTH_JWT_SECRET=preview-secret

Result:

production uses base plus production override plus production vars

preview uses base plus preview override plus preview vars

Single config.json Workflow

This must remain supported.

A team can choose:

only config.json

no overlays

all per-environment differences expressed through env(NAME)

That is a valid model, especially when most differences are secrets.

Platform Environment Model

The platform should store effective environment config, not overlay files.

Each platform environment contains:

environment name

effective merged config document

environment variable store

revision metadata

source metadata

The dashboard should never need to represent:

“this came from config.preview.json”

“this came from config.feat-a.json”

Those are repo authoring details.

The dashboard should represent:

effective config for environment preview

effective config for environment feat-a

variable set for environment preview

variable set for environment feat-a

Sync Model

Production Sync

Syncing production means:

compute effective production config:

config.json -> config.production.json if present

validate merged config

upload it as the new production environment revision

Shared Preview Sync

Syncing config.preview.json means:

compute effective preview config:

config.json -> config.preview.json

validate merged config

upload it as the new preview environment revision

all branches assigned to preview reconcile to it

This is environment fan-out, not branch fan-out.

Branch-Specific Sync

Syncing config.feat-a.json means:

compute effective branch config:

config.json -> config.preview.json -> config.feat-a.json

upload it as environment feat-a

only branch feat-a reconciles to it

Variable Propagation

Use the same inheritance idea for variables:

production vars are standalone

preview vars are shared defaults for preview

branch-specific preview vars override preview vars by name

That matches Vercel’s branch-specific preview behavior: “You only need to add the values you wish to override.” (Vercel Environment Variables docs)

Custom Environments

Custom environments should be supported, but inheritance should stay simple.

Recommendation

When creating a custom environment, allow:

no parent

inherit from production

inherit from preview

or, more generally:

inherit from exactly one parent environment

Do not support arbitrary inheritance graphs or deep chains.

Why

This keeps the model understandable:

preview is the shared non-prod base

staging can inherit from preview if it is “preview plus a few changes”

qa can inherit from production if it is “production-like plus a few changes”

This also mirrors Vercel’s simpler model of seeding custom environments from another environment rather than exposing a complex inheritance tree. Their docs describe custom environments as being able to “Import variables from another environment to seed” the new one. (Vercel Environments docs)

Custom Environment Effective Config

If staging inherits from preview:

config.json

config.preview.json

config.staging.json

If qa inherits from production:

config.json

config.production.json if present

config.qa.json

The same parent model should apply to variables.

CLI Experience

Primary workflows should be command-driven, not file-driven.

Config Commands

supabase config effective --env <env>

supabase config diff --env <a> --env <b>

supabase config set <path>=<value> --env <env>

supabase config unset <path> --env <env>

Variable Commands

supabase env vars list --env <env>

supabase env vars set <NAME>=<value> --env <env>

supabase env vars unset <NAME> --env <env>

Environment Commands

supabase env list

supabase env create <env> --parent=preview|production

supabase env delete <env>

supabase env promote <from> --to <to>

supabase env prune --dry-run

Best-DX branch example

On branch feat-a:

branch-only config change:

supabase config set auth.additional_redirect_urls[3]=https://feat-a-demo.example.com/auth/callback --env current

branch-only secret:

supabase env vars set AUTH_JWT_SECRET=... --env current

The CLI resolves current -> feat-a and writes only the delta.

Dashboard Behavior

Code-Managed

If an environment is code-managed:

repo is the source of truth for config

platform stores the effective config

dashboard shows config read-only

dashboard still allows environment variable operations

secret values remain redacted/write-only

Dashboard-Managed

If an environment is dashboard-managed:

platform is the source of truth for config

repo overlays do not represent it

One-Way Ejection

Ejection should be one-way.

Once an environment is ejected to dashboard-managed, it should no longer be modeled as a repo override environment.

That keeps the model aligned with infrastructure-as-code expectations.

Pull / Import Model

If a project starts dashboard-only and later imports into code:

pull should write only config.json

it should import one effective environment, usually production/default

it should not try to synthesize config.<env>.json files automatically

Why:

the dashboard stores effective environment config, not override intent

override structure is a code authoring model, not a dashboard representation

inferring overrides from effective configs is possible, but should not be the default bootstrap path

If the team later wants preview-in-code, they explicitly create config.preview.json.

If they later want production-specific code overrides, they explicitly create config.production.json.

Use Cases

Shared Preview

all PR branches use preview

config.preview.json changes affect all preview branches

preview vars affect all preview branches

Branch-Specific Preview

feat-a inherits preview

config.feat-a.json only contains the branch delta

branch vars only contain the branch delta

Production-Only Behavior

config.production.json enables something only for production

preview does not need to explicitly disable it unless it wants to override shared base differently

Custom Staging

staging inherits preview

config.staging.json defines only staging-specific changes

staging vars inherit preview vars, then override selected names

Single Config + Env Vars Only

only config.json

no overrides

env(NAME) does all per-environment variation

Acceptance Criteria

config.json is the shared base.

config.production.json is optional and only defines production overrides.

config.preview.json is optional and only defines preview overrides.

Users can stay on a single config.json forever if they want.

Preview is first-class and special.

Branch-specific preview config inherits shared preview config by default.

The design document contains a concrete auth example where preview uses email/password while production uses social login.

The design document contains a branch-only redirect URL example based on auth.additional_redirect_urls.

Custom environments can inherit from exactly one parent.

Environment variables follow the same inheritance intuition as config.

Platform stores effective per-environment config and variables, not overlay files.

Dashboard represents effective environments, not repo override structure.

pull imports config.json only.

Ejection from code-managed to dashboard-managed is one-way.

Sources

Vercel Git docs: https://vercel.com/docs/git

Vercel Environment Variables docs: https://vercel.com/docs/environment-variables

Vercel Environments docs: https://vercel.com/docs/deployments/environments#custom-environments

Supabase CLI config docs: https://supabase.com/docs/guides/local-development/cli/config

Supabase Redirect URLs docs: https://supabase.com/docs/guides/auth/redirect-urls
