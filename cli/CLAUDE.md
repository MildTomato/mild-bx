# CLI (`supa`)

The Supabase CLI, built with TypeScript and bundled with tsup.

## Build and run

```bash
npm run build          # Build CLI to dist/ and bin/supa
npm run docs:generate  # Regenerate reference docs from command specs
```

Test from an example project directory:

```bash
cd examples/auth-rules
../../cli/bin/supa project env list --json
```

## Command structure

Every command follows a three-file pattern:

```
src/commands/<parent>/<command>/
  command.ts   # Declarative spec (name, options, args, examples)
  index.ts     # Arg parser and router (arg → handler)
  src/*.ts     # Implementation (business logic)
```

For commands with subcommands (like `project env`), the parent directory
contains a `command.ts` with all subcommand specs and an `index.ts` router
that dispatches to child directories.

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

- `jsonOption`, `profileOption`, `yesOption`, `verboseOption`
- `environmentOption`, `branchOption`, `secretOption`, `pruneOption`
- `planOption`, `dryRunOption`, `orgOption`, `regionOption`

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
- **Spinners**: Use `createSpinner` from `src/lib/spinner.ts` for
  interactive progress indicators.
