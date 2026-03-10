import chalk from "chalk";

/**
 * Prints an "Update available" notice to stderr when the SUPA_UPDATE_AVAILABLE
 * environment variable is set.
 *
 * Controlled entirely by the env var:
 *   SUPA_UPDATE_AVAILABLE="1.2.3"  →  prints the notice with that version string.
 *
 * Suppressed when:
 *   - The env var is not set or is empty
 *   - The --json flag is present in process.argv
 *   - stdout is not a TTY (e.g. piped output)
 */
export function printUpdateNotice(): void {
  const version = process.env.SUPA_UPDATE_AVAILABLE;
  if (!version) return;
  if (process.argv.includes("--json")) return;
  if (!process.stdout.isTTY) return;

  const notice =
    "  " +
    chalk.yellow("Update available") +
    "  " +
    chalk.bold(chalk.yellow(version)) +
    "  " +
    chalk.yellow("→  Run: ") +
    chalk.bold(chalk.yellow("brew upgrade supa"));

  process.stderr.write("\n\n" + notice + "\n\n");
}
