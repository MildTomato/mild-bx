/**
 * Watch command - watch for changes and sync
 *
 * Styling based on external/cli watch command:
 * - Raw ANSI output for in-place updates
 * - Heartbeat animation when idle
 * - Consistent color scheme
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient } from "../lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getProfileForBranch,
} from "../lib/config.js";
import { getCurrentBranch } from "../lib/git.js";

// ANSI color codes - semantic naming
const C = {
  reset: "\x1b[0m",
  value: "\x1b[37m", // Primary values (white)
  secondary: "\x1b[38;5;244m", // Secondary text (gray)
  icon: "\x1b[33m", // Icons and accents (yellow)
  fileName: "\x1b[36m", // File names (cyan)
  error: "\x1b[31m", // Errors (red)
  success: "\x1b[32m", // Success (green)
  bold: "\x1b[1m",
} as const;

// Spinner frames (same as ink-spinner dots, reversed)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HEARTBEAT_FRAMES = ["⠏", "⠇", "⠧", "⠦", "⠴", "⠼", "⠸", "⠹", "⠙", "⠋"];

interface WatchOptions {
  profile?: string;
  typesInterval?: string;
  noBranchWatch?: boolean;
  json?: boolean;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const cwd = process.cwd();

  // Parse interval
  let intervalMs = 30000; // default 30s
  if (options.typesInterval) {
    const match = options.typesInterval.match(/^(\d+)(s|m)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "s";
      intervalMs = value * (unit === "m" ? 60000 : 1000);
    }
  }

  // Load config
  const config = loadProjectConfig(cwd);
  if (!config) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "No config found" }),
      );
    } else {
      console.error(
        `\n${C.error}Error:${C.reset} No supabase/config.json found`,
      );
      console.error(`  Run ${C.value}supa-demo init${C.reset} to initialize\n`);
    }
    return;
  }

  // Get token
  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "Not authenticated" }),
      );
    } else {
      console.error(`\n${C.error}Error:${C.reset} Not authenticated`);
      console.error(`  Set SUPABASE_ACCESS_TOKEN environment variable\n`);
    }
    return;
  }

  // Get current state
  let currentBranch = getCurrentBranch(cwd) || "unknown";
  let profile = getProfileOrAuto(config, options.profile, currentBranch);
  let projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message: "No project_id configured",
        }),
      );
    } else {
      console.error(`\n${C.error}Error:${C.reset} No project_id configured`);
      console.error(`  Add "project_id" to supabase/config.json\n`);
    }
    return;
  }

  // JSON mode - output events as NDJSON
  if (options.json) {
    console.log(
      JSON.stringify({
        status: "running",
        profile: profile?.name,
        projectRef,
        branch: currentBranch,
      }),
    );

    let lastTypes = "";
    let lastBranch = currentBranch;

    const branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);
        console.log(
          JSON.stringify({
            event: matched ? "profile_changed" : "branch_changed",
            branch: newBranch,
            profile: matched?.name,
          }),
        );
      }
    }, 5000);

    const typesCheck = setInterval(async () => {
      try {
        const client = createClient(token);
        const resp = await client.getTypescriptTypes(projectRef!, "public");
        if (resp.types !== lastTypes) {
          lastTypes = resp.types;
          const typesPath = join(cwd, "supabase", "types", "database.ts");
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, resp.types);
          console.log(
            JSON.stringify({ event: "types_updated", path: typesPath }),
          );
        }
      } catch (err) {
        console.log(
          JSON.stringify({
            event: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    }, intervalMs);

    process.on("SIGINT", () => {
      clearInterval(branchCheck);
      clearInterval(typesCheck);
      console.log(JSON.stringify({ status: "stopped" }));
      process.exit(0);
    });

    return;
  }

  // Interactive mode - raw ANSI output
  let currentLine = "";
  let spinnerInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let spinnerFrame = 0;
  let heartbeatFrame = 0;
  let lastActivity = Date.now();

  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const clearLine = () => {
    if (currentLine) {
      const len = stripAnsi(currentLine).length;
      process.stdout.write(`\r${" ".repeat(len)}\r`);
      currentLine = "";
    }
  };

  const writeLine = (msg: string) => {
    clearLine();
    process.stdout.write(`\r${msg}\x1b[K`);
    currentLine = msg;
  };

  const log = (msg: string) => {
    clearLine();
    console.log(msg);
    lastActivity = Date.now();
  };

  const startSpinner = (msg: string) => {
    lastActivity = Date.now();
    stopHeartbeat();
    if (spinnerInterval) clearInterval(spinnerInterval);

    spinnerFrame = 0;
    const update = () => {
      const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
      writeLine(`${C.icon}${char}${C.reset} ${msg}`);
      spinnerFrame++;
    };
    update();
    spinnerInterval = setInterval(update, 80);
  };

  const stopSpinner = (msg: string, success = true) => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    const icon = success ? `${C.success}✓${C.reset}` : `${C.error}✗${C.reset}`;
    log(`${icon} ${msg}`);
    startHeartbeat();
  };

  const startHeartbeat = () => {
    if (heartbeatInterval) return;

    heartbeatInterval = setInterval(() => {
      const idle = Date.now() - lastActivity > 1000;
      if (idle && !spinnerInterval) {
        const char = HEARTBEAT_FRAMES[heartbeatFrame % HEARTBEAT_FRAMES.length];
        writeLine(`${C.secondary}${char} Watching...${C.reset}`);
        heartbeatFrame++;
      }
    }, 350);
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  // Print header
  console.log("");
  console.log(
    `${C.secondary}Project:${C.reset} ${C.value}${projectRef}${C.reset}`,
  );
  console.log(
    `${C.secondary}Profile:${C.reset} ${C.value}${profile?.name || "default"}${C.reset}`,
  );
  console.log(
    `${C.secondary}Branch:${C.reset}  ${C.fileName}${currentBranch}${C.reset}`,
  );
  console.log(
    `${C.secondary}Types:${C.reset}   ${C.value}every ${intervalMs / 1000}s${C.reset}`,
  );
  console.log("");

  let lastTypes = "";
  let lastBranch = currentBranch;

  // Branch watcher
  let branchCheck: NodeJS.Timeout | undefined;
  if (!options.noBranchWatch) {
    branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);

        if (matched && matched.name !== profile?.name) {
          profile = matched;
          projectRef = getProjectRef(config, matched);
          log(
            `${C.icon}→${C.reset} Branch ${C.fileName}${newBranch}${C.reset} → profile ${C.value}${matched.name}${C.reset}`,
          );
        } else {
          log(
            `${C.icon}→${C.reset} Branch ${C.fileName}${newBranch}${C.reset}`,
          );
        }
      }
    }, 5000);
  }

  // Types regeneration
  const regenerateTypes = async () => {
    if (!projectRef) return;

    startSpinner(`${C.secondary}Fetching types...${C.reset}`);

    try {
      const client = createClient(token);
      const resp = await client.getTypescriptTypes(projectRef, "public");

      if (resp.types !== lastTypes) {
        lastTypes = resp.types;
        const typesPath = join(cwd, "supabase", "types", "database.ts");
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, resp.types);
        stopSpinner(
          `Types updated ${C.fileName}supabase/types/database.ts${C.reset}`,
        );
      } else {
        stopSpinner(`${C.secondary}Types unchanged${C.reset}`);
      }
    } catch (err) {
      stopSpinner(
        `${C.error}Types failed: ${err instanceof Error ? err.message : "Unknown error"}${C.reset}`,
        false,
      );
    }
  };

  // Initial types fetch
  await regenerateTypes();

  // Start types interval
  const typesCheck = setInterval(regenerateTypes, intervalMs);

  // Start heartbeat
  startHeartbeat();

  // Graceful shutdown
  const cleanup = () => {
    stopHeartbeat();
    if (spinnerInterval) clearInterval(spinnerInterval);
    if (branchCheck) clearInterval(branchCheck);
    clearInterval(typesCheck);
    clearLine();
    console.log(`\n${C.secondary}Watch stopped${C.reset}\n`);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
