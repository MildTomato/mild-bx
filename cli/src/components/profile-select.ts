/**
 * Interactive profile selector with ASCII art preview
 */

import * as readline from "readline";
import { Writable } from "stream";
import chalk from "chalk";
import type { WorkflowProfileDefinition } from "../lib/workflow-profiles.js";

const pc = {
  green: chalk.green,
  red: chalk.red,
  cyan: chalk.cyan,
  yellow: chalk.yellow,
  blue: chalk.blue,
  dim: chalk.dim,
  bold: chalk.bold,
  underline: chalk.underline,
};

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

const S_STEP_ACTIVE = pc.green("◆");
const S_STEP_CANCEL = pc.red("■");
const S_STEP_SUBMIT = pc.green("◇");
const S_BAR = pc.dim("│");

export const cancelSymbol = Symbol("cancel");

/**
 * Colorize the ASCII art based on keywords
 */
function colorizeArt(art: string): string {
  return art
    .replace(/Local/g, pc.yellow("Local"))
    .replace(/PRODUCTION/g, pc.red("PRODUCTION"))
    .replace(/STAGING/g, pc.cyan("STAGING"))
    .replace(/preview[^\s▓]*/gi, (match) => pc.blue(match))
    .replace(/feature\/\w+/g, (match) => pc.blue(match))
    .replace(/▓/g, pc.dim("▓"))
    .replace(/supa push/g, pc.dim("supa push"))
    .replace(/supa merge/g, pc.dim("supa merge"))
    .replace(/merge PR/g, pc.dim("merge PR"));
}

export async function profileSelect(
  profiles: WorkflowProfileDefinition[]
): Promise<WorkflowProfileDefinition | symbol> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: false,
    });

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin, rl);

    let cursor = 0;
    let lastRenderHeight = 0;

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i++) {
          process.stdout.write("\x1b[2K\x1b[1B");
        }
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
      }
    };

    const render = (state: "active" | "submit" | "cancel" = "active"): void => {
      clearRender();

      const lines: string[] = [];
      const currentProfile = profiles[cursor]!;

      // Spacer
      lines.push(`${S_BAR}`);

      if (state === "submit") {
        // Inline answer format
        lines.push(`${S_STEP_SUBMIT}  ${pc.bold("Workflow profile")} ${pc.dim("·")} ${pc.dim(currentProfile.name)}`);
      } else if (state === "cancel") {
        lines.push(`${S_STEP_CANCEL}  ${pc.bold("Workflow profile")}`);
        lines.push(`${S_BAR}  ${pc.dim(chalk.strikethrough("Cancelled"))}`);
      } else if (state === "active") {
        // Header
        lines.push(`${S_STEP_ACTIVE}  ${pc.bold("Workflow profile")}`);
        // Hint
        lines.push(`${S_BAR}  ${pc.dim("↑↓ navigate, enter select")}`);
        lines.push(`${S_BAR}`);

        // Profile options
        for (let i = 0; i < profiles.length; i++) {
          const profile = profiles[i]!;
          const isCursor = i === cursor;
          const prefix = isCursor ? pc.cyan("❯") : " ";
          const radio = isCursor ? pc.green("●") : pc.dim("○");
          const label = isCursor ? pc.underline(profile.name) : profile.name;
          lines.push(`${S_BAR} ${prefix} ${radio} ${label} ${pc.dim(`- ${profile.title}`)}`);
        }

        lines.push(`${S_BAR}`);

        // Show ASCII art for current selection
        const artLines = colorizeArt(currentProfile.art).trim().split("\n");
        for (const artLine of artLines) {
          lines.push(`${S_BAR}  ${artLine}`);
        }

        lines.push(`${S_BAR}`);
        lines.push(`${S_BAR}  ${pc.dim(currentProfile.description)}`);
        lines.push(`${S_BAR}  ${pc.dim(`Vibe: ${currentProfile.vibe}`)}`);
        lines.push(`${S_BAR}`);
      }

      process.stdout.write(lines.join("\n") + "\n");
      lastRenderHeight = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.removeListener("keypress", keypressHandler);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const submit = (): void => {
      render("submit");
      cleanup();
      resolve(profiles[cursor]!);
    };

    const cancel = (): void => {
      render("cancel");
      cleanup();
      resolve(cancelSymbol);
    };

    const keypressHandler = (_str: string, key: readline.Key): void => {
      if (!key) return;

      if (key.name === "return") {
        submit();
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cancel();
        return;
      }

      if (key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }

      if (key.name === "down") {
        cursor = Math.min(profiles.length - 1, cursor + 1);
        render();
        return;
      }
    };

    process.stdin.on("keypress", keypressHandler);
    render();
  });
}
