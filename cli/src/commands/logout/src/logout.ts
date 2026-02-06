/**
 * Logout command - remove stored access token
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { deleteAccessTokenAsync, isLoggedInAsync } from "@/lib/config.js";

interface LogoutOptions {
  yes?: boolean;
  json?: boolean;
}

export async function logoutCommand(options: LogoutOptions): Promise<void> {
  // Check if logged in
  if (!(await isLoggedInAsync())) {
    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: "Not logged in" }));
    } else {
      console.log(chalk.dim("Not logged in."));
    }
    return;
  }

  // Non-TTY mode without --yes
  if (!options.yes && !options.json && !process.stdin.isTTY) {
    console.error("Error: Interactive mode requires a TTY.");
    console.error("Use --yes to skip confirmation:");
    console.error("  supa logout --yes");
    process.exit(1);
  }

  // Confirm unless --yes is passed
  if (!options.yes && !options.json) {
    const confirmed = await p.confirm({
      message: "Are you sure you want to log out?",
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Logout cancelled");
      process.exit(0);
    }
  }

  // Delete the token
  const deleted = await deleteAccessTokenAsync();

  if (deleted) {
    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: "Logged out successfully" }));
    } else {
      console.log(chalk.green("Logged out successfully."));
      console.log(chalk.dim("Access token removed from keyring and ~/.supabase/access-token"));
    }
  } else {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "Failed to delete access token",
        }),
      );
    } else {
      console.error(chalk.red("Failed to delete access token."));
    }
    process.exitCode = 1;
  }
}
