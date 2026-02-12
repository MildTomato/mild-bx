/**
 * Organizations command - list organizations
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { createClient } from "@/lib/api.js";
import { requireAuth } from "@/lib/config.js";
import { searchSelect } from "@/components/search-select.js";

interface OrgsOptions {
  json?: boolean;
}

export async function orgsCommand(options: OrgsOptions): Promise<void> {
  const token = await requireAuth({ json: options.json });

  const client = createClient(token);

  // JSON mode - just list
  if (options.json) {
    try {
      const orgs = await client.listOrganizations();
      console.log(JSON.stringify({ status: "success", organizations: orgs }));
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch organizations",
        }),
      );
    }
    return;
  }

  // Non-TTY mode without --json
  if (!process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output:");
    console.error("  supa orgs --json");
    process.exit(1);
  }

  // Interactive mode - fetch and display
  const spinner = p.spinner();
  spinner.start("Fetching organizations...");

  try {
    const orgs = await client.listOrganizations();
    spinner.stop(`Found ${orgs.length} organization${orgs.length === 1 ? "" : "s"}`);

    if (orgs.length === 0) {
      console.log(chalk.dim("\nNo organizations found."));
      return;
    }

    const selected = await searchSelect({
      message: "Select organization",
      items: orgs.map((o) => ({ value: o, label: o.name, hint: o.slug })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    console.log(`\n${chalk.green("Selected:")} ${selected.name} (${selected.slug})`);
    console.log(`\n${chalk.dim("To use this org:")}`);
    console.log(`  supa projects --org ${selected.slug}`);
  } catch (error) {
    spinner.stop("Failed to fetch organizations");
    console.error(
      chalk.red("Error:"),
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exit(1);
  }
}
