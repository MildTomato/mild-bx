/**
 * Login command - authenticate with Supabase
 * Matches supabase-cli login flow exactly
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { exec } from "node:child_process";
import { createClient } from "@/lib/api.js";
import {
  getAccessTokenAsync,
  isValidAccessToken,
  saveAccessTokenAsync,
} from "@/lib/config.js";
import { createSpinner } from "@/lib/spinner.js";
import { generateKeyPair, decryptToken } from "./encryption.js";

const DASHBOARD_URL = "https://supabase.com/dashboard";
const API_URL = "https://api.supabase.com";

interface LoginOptions {
  token?: string;
  json?: boolean;
  noBrowser?: boolean;
}

interface AccessTokenResponse {
  id: string;
  created_at: string;
  access_token: string;
  public_key: string;
  nonce: string;
}

/**
 * Generate a token name like: cli_user@hostname_timestamp
 */
function generateTokenName(): string {
  try {
    const user = userInfo().username;
    const host = hostname();
    const timestamp = Math.floor(Date.now() / 1000);
    return `cli_${user}@${host}_${timestamp}`;
  } catch {
    return `cli_${Math.floor(Date.now() / 1000)}`;
  }
}

/**
 * Open URL in default browser
 */
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;

    if (platform === "darwin") {
      cmd = `open "${url}"`;
    } else if (platform === "win32") {
      cmd = `start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Poll for access token from API
 */
async function pollForAccessToken(
  sessionId: string,
  deviceCode: string,
): Promise<AccessTokenResponse> {
  const url = `${API_URL}/platform/cli/login/${sessionId}?device_code=${deviceCode}`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  // If token provided directly, just save it
  if (options.token) {
    if (!isValidAccessToken(options.token)) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Invalid token format. Must be like `sbp_0102...1920`",
          }),
        );
      } else {
        console.error(chalk.red("Invalid token format."));
        console.error(chalk.dim("Access tokens must match: sbp_[a-f0-9]{40}"));
      }
      process.exitCode = 1;
      return;
    }

    // Verify token by making API call
    const spinner = options.json ? null : createSpinner();
    spinner?.start("Verifying token...");

    try {
      const client = createClient(options.token);
      await client.listOrganizations();

      await saveAccessTokenAsync(options.token);
      spinner?.stop("Token verified");

      if (options.json) {
        console.log(JSON.stringify({ status: "success", message: "Logged in successfully" }));
      } else {
        console.log(chalk.green("You are now logged in. ") + chalk.cyan("Happy coding!"));
      }
    } catch (error) {
      spinner?.stop("Verification failed");
      const message = error instanceof Error ? error.message : "Failed to verify token";

      if (options.json) {
        console.log(JSON.stringify({ status: "error", message }));
      } else {
        console.error(chalk.red("Failed to verify token:"), message);
      }
      process.exitCode = 1;
    }
    return;
  }

  // Check if already logged in
  const existingToken = await getAccessTokenAsync();
  if (existingToken) {
    if (options.json) {
      console.log(JSON.stringify({ status: "success", message: "Already logged in" }));
    } else {
      console.log(chalk.green("Already logged in."));
      console.log(chalk.dim("Use `supa logout` to log out first."));
    }
    return;
  }

  // Non-TTY mode without token
  if (options.json || !process.stdin.isTTY) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "Token required. Use --token or run interactively.",
        }),
      );
    } else {
      console.error("Error: Token required in non-interactive mode.");
      console.error("Use --token to provide an access token:");
      console.error("  supa login --token sbp_xxx");
    }
    process.exitCode = 1;
    return;
  }

  // Interactive browser-based login flow
  const { publicKey, privateKey } = await generateKeyPair();
  const sessionId = randomUUID();
  const tokenName = generateTokenName();
  const encodedPublicKey = Buffer.from(publicKey).toString("hex");

  const loginUrl =
    `${DASHBOARD_URL}/cli/login?session_id=${sessionId}` +
    `&token_name=${encodeURIComponent(tokenName)}` +
    `&public_key=${encodedPublicKey}`;

  if (options.noBrowser) {
    console.log(`\nOpen this URL in your browser to log in:\n`);
    console.log(chalk.cyan(loginUrl));
  } else {
    console.log(
      `\nHello from ${chalk.cyan("Supabase")}! Press ${chalk.cyan("Enter")} to open browser and login automatically.`,
    );

    // Wait for Enter
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });

    console.log(`\nOpening browser... If it didn't open, visit:`);
    console.log(chalk.dim(loginUrl));

    try {
      await openBrowser(loginUrl);
    } catch (error) {
      console.error(chalk.yellow("Could not open browser automatically."));
    }
  }

  // Prompt for verification code with retries
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.error(chalk.red(lastError?.message || "Invalid code"));
      console.log(`Retry (${attempt}/${maxRetries}):`);
    }

    const codeInput = await p.text({
      message: "Enter your verification code",
      placeholder: "xxxxxx",
    });

    if (p.isCancel(codeInput)) {
      p.cancel("Login cancelled");
      process.exit(0);
    }

    const deviceCode = codeInput.trim();

    try {
      const response = await pollForAccessToken(sessionId, deviceCode);

      // Decrypt the access token
      const accessToken = await decryptToken(
        response.access_token,
        response.public_key,
        response.nonce,
        privateKey,
      );

      // Save the token
      await saveAccessTokenAsync(accessToken);

      console.log(`\nToken ${chalk.bold(tokenName)} created successfully.\n`);
      console.log(chalk.green("You are now logged in. ") + chalk.cyan("Happy coding!"));
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");

      if (attempt === maxRetries) {
        console.error(chalk.red("Login failed:"), lastError.message);
        process.exitCode = 1;
        return;
      }
    }
  }
}
