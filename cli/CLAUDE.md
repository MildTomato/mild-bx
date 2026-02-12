# CLI (`supa`)

The Supabase CLI, built with TypeScript, bundled with tsup, and compiled
to a standalone binary with bun.

When adding or modifying commands, use the `cli-guidelines` skill.

## Build and run

```bash
npm run build          # Build CLI to dist/ and bin/supa
npm run dev            # Watch mode (tsup --watch)
npm run docs:generate  # Regenerate reference docs from command specs
```

There are no tests yet. Vitest is configured as a dev dependency.

## Testing commands

After `npm run build`, test via the linked binary:

```bash
supa --help
supa project pull --plan
```

For a quick check without a full build, run the compiled output
directly:

```bash
node cli/dist/index.js --help
```

## Path aliases

tsup resolves these aliases:

- `@/lib` → `./src/lib`
- `@/components` → `./src/components`
- `@/commands` → `./src/commands`
- `@/util` → `./src/util`

## Command structure

Every command follows this pattern (example: `project pull`):

```
src/commands/project/pull/
  command.ts              # Declarative spec (satisfies Command)
  index.ts                # Arg parser → calls handler in src/
  src/pull.ts             # Implementation (business logic)
  docs/intro.md           # Overview prose (required)
  docs/option.types-only.md  # Extra detail for --types-only flag
```

For commands with subcommands (like `project env`), the parent directory
contains a `command.ts` with all subcommand specs and an `index.ts` router
that dispatches to child directories.

Command handlers return an exit code:

```typescript
export default async function commandName(argv: string[]): Promise<number | void>
```

### Adding a new command

1. Create `command.ts` with the spec (`satisfies Command`).
2. Create `index.ts` that parses args and calls the handler.
3. Create `src/<name>.ts` with the implementation.
4. Register in the parent's `command.ts` (subcommands array) and `index.ts`
   (switch case). For top-level commands, also register in
   `src/commands/index.ts`.
5. Create a `docs/` directory (see "Documentation" below).
6. Run `npm run docs:generate` from the `cli/` directory.

### Shared options

Reuse options from `src/util/commands/arg-common.ts` instead of defining
inline:

- `yesOption`, `jsonOption`, `profileOption`, `verboseOption`
- `planOption`, `dryRunOption`
- `orgOption`, `regionOption`, `nameOption`
- `environmentOption`, `branchOption`
- `secretOption`, `pruneOption`

## Project context resolution

Most project commands need config, profile, project ref, and auth token.
Use the shared helpers in `src/lib/resolve-project.ts` instead of
duplicating this boilerplate:

```typescript
import {
  resolveProjectContext,
  resolveConfig,
  requireTTY,
} from "@/lib/resolve-project.js";

// Full context (config + profile + projectRef + auth)
const { cwd, config, branch, profile, projectRef, token } =
  await resolveProjectContext(options);

// Config only (no auth, no projectRef requirement)
const { cwd, config, branch, profile } = resolveConfig(options);

// TTY check for interactive commands
requireTTY();
```

`resolveProjectContext` and `resolveConfig` handle JSON/interactive error
output and call `process.exit` on failure. `requireTTY` exits if stdin
isn't a terminal.

Don't use these in `init` or `dev` — those are wizard-based commands with
their own patterns.

## Config

Loads project config from `supabase/config.json` (primary) or
`supabase/config.toml` (legacy fallback). Validated with Zod in
`src/lib/config-spec.ts`.

Access token resolution priority: env var (`SUPABASE_ACCESS_TOKEN`) →
OS keyring (profile-scoped) → OS keyring (legacy) → file
(`~/.supabase/access-token`).

Don't edit `src/lib/api-types.ts` directly — it's auto-generated from
the OpenAPI spec. Regenerate with `npm run generate:api-types`.

## .env setup

The CLI loads `.env`, `supabase/.env`, and `.env.local` from the
working directory at startup (`src/index.ts`). Several commands (`dev`,
`push`, `pull`, `seed`) require `SUPABASE_DB_PASSWORD` to be set.
`supa init` writes this to `.env` automatically when linking a project,
but when working on the CLI itself you need to add it manually:

```
SUPABASE_DB_PASSWORD=your-db-password
```

Get the password from the Supabase dashboard. Use `--verbose` to
confirm the CLI is picking it up.

## Documentation

Every command must have a `docs/` directory. The doc generator merges
these files into the auto-generated reference pages:

| File | Purpose |
|------|---------|
| `docs/intro.md` | Overview prose at the top of the page (required) |
| `docs/option.<name>.md` | Extra details for a specific option |
| `docs/example.<slug>.md` | Extra content for a specific example |

After modifying command specs or docs files, regenerate:

```bash
npm run docs:generate
```

This writes to `apps/docs/content/docs/cli/reference/`. Those files are
auto-generated — don't edit them directly. See `apps/docs/CLAUDE.md` for
the full docs structure.

## Key conventions

- **JSON mode**: Every command supports `--json`. Use `options.json` to
  branch. Send data JSON to stdout (`console.log`), messages to stderr
  (`console.error`).
- **Exit codes**: Use `EXIT_CODES` from `src/lib/exit-codes.ts`.
- **Command headers**: Use `printCommandHeader` from
  `src/components/command-header.ts` with the `context` option for
  key-value lines (Project, Profile, Env, and so on).
- **Spinners**: Use `p.spinner()` from `@clack/prompts` for
  interactive progress indicators.
- **Colors**: Use semantic helpers from `src/lib/styles.ts` (`success()`,
  `error()`, `warning()`, etc.) or raw ANSI from `src/lib/colors.ts`.
