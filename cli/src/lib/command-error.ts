/**
 * Centralised command error handler.
 *
 * All commands call handleCommandError() in their catch blocks.
 * This ensures identical output for auth errors, permission errors,
 * and general API failures across every command.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { AuthError } from "./api.js";
import type { SupabaseClient } from "./api.js";
import { EXIT_CODES } from "./exit-codes.js";

export async function handleCommandError(
  error: unknown,
  options: { json?: boolean },
  client?: SupabaseClient,
  projectRef?: string
): Promise<never> {
  const isAuthError = error instanceof AuthError;

  if (isAuthError) {
    // Try to identify which account the token belongs to
    let accountLine = "";
    if (client) {
      try {
        const orgs = await client.listOrganizations();
        if (orgs.length > 0) {
          accountLine = `\n   ${chalk.dim("Logged in with access to:")} ${orgs.map((o) => o.name).join(", ")}`;
        }
      } catch {
        // best-effort — truly expired token won't be able to list orgs
      }
    }

    const projectLine = projectRef
      ? `Access denied for project \`${projectRef}\`.`
      : "Access denied.";

    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          code: error.statusCode === 403 ? "forbidden" : "unauthorized",
          message: projectLine,
          account: accountLine || undefined,
          exitCode: EXIT_CODES.AUTH_FAILURE,
        })
      );
    } else {
      p.log.error(
        `${chalk.bold(projectLine)}${accountLine}\n\n` +
        `${chalk.dim("• Wrong account?")} Run ${chalk.cyan("`supa logout`")} then ${chalk.cyan("`supa login`")}\n` +
        `${chalk.dim("• Token missing permissions?")} Run ${chalk.cyan("`supa logout`")} then ${chalk.cyan("`supa login`")}\n` +
        `${chalk.dim("• Not been granted access?")} Ask a project owner or admin to invite you`
      );
    }
    process.exit(EXIT_CODES.AUTH_FAILURE);
  }

  const msg = error instanceof Error ? error.message : String(error);
  if (options.json) {
    console.log(
      JSON.stringify({
        status: "error",
        message: msg,
        exitCode: EXIT_CODES.GENERIC_ERROR,
      })
    );
  } else {
    p.log.error(msg);
  }
  process.exit(EXIT_CODES.GENERIC_ERROR);
}
