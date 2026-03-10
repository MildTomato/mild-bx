# Command UI conventions

Every command **must** follow these patterns. No exceptions.

## Structure of a command handler

```ts
// 1. Header (TTY only)
printCommandHeader({
  command: "supa project foo bar",
  description: ["One line describing what this does."],
  context: [["Project", projectRef], ["Branch", branch]],
});

// 2. Spinner for every async operation
const spinner = options.json ? null : p.spinner();
spinner?.start("Doing the thing…");
// ... await work ...
spinner?.stop("Done");

// 3. Output inside the S_BAR rail
console.log(S_BAR);
console.log(`${S_BAR}  ${chalk.dim("Label:")} ${chalk.cyan(value)}`);
console.log(S_BAR);
```

## Never use raw console.log for UI

Use these instead:

| Instead of | Use |
|---|---|
| `console.log("some message")` | `p.log.message(...)` |
| `console.log(chalk.green("✓ ..."))` | `p.log.success(...)` or spinner stop message |
| `console.error("Error: ...")` | `p.log.error(...)` |
| `console.log(chalk.yellow("Warning"))` | `p.log.warn(...)` |

`console.log` is only allowed for **JSON output** (`console.log(JSON.stringify(...))`)
and for raw content that belongs outside the rail (e.g. SQL diff output).

## JSON mode

All commands support `--json`. In JSON mode:
- Skip all Clack UI (no header, no spinner, no prompts)
- Success → `console.log(JSON.stringify({ status: "success", ... }))` to stdout
- Errors → `console.error(JSON.stringify({ status: "error", message, exitCode }))` to stderr
- Never mix human-readable output with JSON

## Colors (chalk)

| Use case | Color |
|---|---|
| Names, refs, keys, values | `chalk.cyan()` |
| Success messages | `chalk.green()` |
| Warnings | `chalk.yellow()` |
| Errors | `chalk.red()` |
| Labels, secondary text | `chalk.dim()` |

Do not invent new color usages. Stick to this list.

## Confirmations

```ts
const proceed = await p.confirm({ message: "Do the thing?" });
if (p.isCancel(proceed) || !proceed) {
  p.cancel("Cancelled");
  process.exit(EXIT_CODES.USER_CANCELLED);
}
```

Always skip confirmation when `--yes` is set or when not TTY.

## Interactive selection

Use `searchSelect` from `@/components/search-select.js` — never `p.select` for lists of
dynamic data. Always check for `cancelSymbol`:

```ts
const selected = await searchSelect({
  message: "Which branch?",
  items: branches.map((b) => ({ value: b.id, label: b.name, hint: b.git_branch })),
});
if (selected === cancelSymbol) {
  p.cancel("Cancelled");
  process.exit(EXIT_CODES.USER_CANCELLED);
}
```

## Non-interactive / no argument

When an argument is required but missing:
- **TTY**: show `searchSelect` to let the user pick
- **Non-TTY / --json**: exit with `EXIT_CODES.VALIDATION_ERROR` and a JSON error

Never hard-error with "argument is required" in TTY mode.

## Exit codes

Always use `EXIT_CODES` from `@/lib/exit-codes.js`:

| Situation | Code |
|---|---|
| Success | `EXIT_CODES.SUCCESS` |
| User cancelled | `EXIT_CODES.USER_CANCELLED` |
| Bad input / missing arg | `EXIT_CODES.VALIDATION_ERROR` |
| Auth failure | `EXIT_CODES.AUTH_FAILURE` |
| Network / API error | `EXIT_CODES.NETWORK_ERROR` |
| Config not found | `EXIT_CODES.CONFIG_NOT_FOUND` |

Never `process.exit(1)` directly.

## Spinner messages

- Use `…` (ellipsis, not `...`) while in progress
- Stop message should be the result, not a repeat of the action
- Highlight key values with `chalk.cyan()` in messages

## TTY check

```ts
const isTTY = process.stdout.isTTY && !options.json;
const spinner = isTTY ? p.spinner() : null;
```

Gate all interactive UI behind `isTTY`. Never prompt in non-TTY mode.
