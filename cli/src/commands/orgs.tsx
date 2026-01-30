/**
 * Organizations command - list and select organizations
 */

import React from "react";
import { render } from "ink";
import { OrgPicker } from "../components/Pickers.js";
import { createClient, type Organization } from "../lib/api.js";
import { getAccessToken } from "../lib/config.js";

interface OrgsOptions {
  json?: boolean;
}

export async function orgsCommand(options: OrgsOptions): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "Not logged in" }),
      );
    } else {
      console.error(
        "Not logged in. Set SUPABASE_ACCESS_TOKEN environment variable.",
      );
    }
    return;
  }

  // JSON mode
  if (options.json) {
    try {
      const client = createClient(token);
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

  // Non-TTY mode without --json: show helpful error
  if (!process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --json for non-interactive output:");
    console.error("  supa orgs --json");
    process.exit(1);
  }

  // Interactive mode
  return new Promise((resolve) => {
    const { unmount } = render(
      <OrgPicker
        onSelect={(org) => {
          unmount();
          console.log(`\nSelected: ${org.name} (${org.slug})`);
          console.log(`\nTo use this org:`);
          console.log(`  supa projects --org ${org.slug}`);
          resolve();
        }}
      />,
    );
  });
}
