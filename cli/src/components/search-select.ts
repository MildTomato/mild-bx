/**
 * Interactive search select prompt (single selection)
 * Based on the skills CLI search-multiselect pattern
 */

import * as readline from "readline";
import { Writable } from "stream";
import chalk from "chalk";

// Create picocolors-compatible API using chalk
const pc = {
  green: chalk.green,
  red: chalk.red,
  cyan: chalk.cyan,
  dim: chalk.dim,
  bold: chalk.bold,
  underline: chalk.underline,
  inverse: chalk.inverse,
  strikethrough: chalk.strikethrough,
};

// Silent writable stream to prevent readline from echoing input
const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export interface SearchItem<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface SearchSelectOptions<T> {
  message: string;
  items: SearchItem<T>[];
  maxVisible?: number;
  initialValue?: T;
  /** Add a leading spacer line (default: true) */
  leadingSpace?: boolean;
}

const S_STEP_ACTIVE = pc.green("◆");
const S_STEP_CANCEL = pc.red("■");
const S_STEP_SUBMIT = pc.green("◇");
const S_BAR = pc.dim("│");

export const cancelSymbol = Symbol("cancel");

/**
 * Interactive search select prompt.
 * Allows users to filter a long list by typing and select a single item.
 */
export async function searchSelect<T>(
  options: SearchSelectOptions<T>
): Promise<T | symbol> {
  const { message, items, maxVisible = 8, initialValue, leadingSpace = true } = options;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: false,
    });

    // Enable raw mode for keypress detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin, rl);

    let query = "";
    let cursor = initialValue ? items.findIndex((i) => i.value === initialValue) : 0;
    if (cursor < 0) cursor = 0;
    let lastRenderHeight = 0;

    const filter = (item: SearchItem<T>, q: string): boolean => {
      if (!q) return true;
      const lowerQ = q.toLowerCase();
      return (
        item.label.toLowerCase().includes(lowerQ) ||
        String(item.value).toLowerCase().includes(lowerQ)
      );
    };

    const getFiltered = (): SearchItem<T>[] => {
      return items.filter((item) => filter(item, query));
    };

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        // Move up and clear each line
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
      const filtered = getFiltered();

      // Spacer line before header (to match Clack spacing)
      if (leadingSpace) {
        lines.push(`${S_BAR}`);
      }

      if (state === "submit") {
        // Inline answer format
        const filtered = getFiltered();
        const selected = filtered[cursor];
        if (selected) {
          lines.push(`${S_STEP_SUBMIT}  ${pc.bold(message)} ${pc.dim("·")} ${pc.dim(selected.label)}`);
        }
      } else if (state === "cancel") {
        lines.push(`${S_STEP_CANCEL}  ${pc.bold(message)}`);
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim("Cancelled"))}`);
      } else if (state === "active") {
        // Header
        lines.push(`${S_STEP_ACTIVE}  ${pc.bold(message)}`);
        // Search input
        const searchLine = `${S_BAR}  ${pc.dim("Search:")} ${query}${pc.inverse(" ")}`;
        lines.push(searchLine);

        // Hint
        lines.push(`${S_BAR}  ${pc.dim("↑↓ navigate, enter select, esc cancel")}`);
        lines.push(`${S_BAR}`);

        // Items
        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible)
        );
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
        const visibleItems = filtered.slice(visibleStart, visibleEnd);

        if (filtered.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim("No matches found")}`);
        } else {
          for (let i = 0; i < visibleItems.length; i++) {
            const item = visibleItems[i]!;
            const actualIndex = visibleStart + i;
            const isCursor = actualIndex === cursor;

            const label = isCursor ? pc.underline(item.label) : item.label;
            const hint = item.hint ? pc.dim(` (${item.hint})`) : "";

            const prefix = isCursor ? pc.cyan("❯") : " ";
            lines.push(`${S_BAR} ${prefix} ${label}${hint}`);
          }

          // Show count if more items
          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
            lines.push(`${S_BAR}  ${pc.dim(parts.join("  "))}`);
          }
        }

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
      const filtered = getFiltered();
      const selected = filtered[cursor];
      if (!selected) return;

      render("submit");
      cleanup();
      resolve(selected.value);
    };

    const cancel = (): void => {
      render("cancel");
      cleanup();
      resolve(cancelSymbol);
    };

    // Handle keypresses
    const keypressHandler = (_str: string, key: readline.Key): void => {
      if (!key) return;

      const filtered = getFiltered();

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
        cursor = Math.min(filtered.length - 1, cursor + 1);
        render();
        return;
      }

      if (key.name === "backspace") {
        query = query.slice(0, -1);
        cursor = 0;
        render();
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        query += key.sequence;
        cursor = 0;
        render();
        return;
      }
    };

    process.stdin.on("keypress", keypressHandler);

    // Initial render
    render();
  });
}
