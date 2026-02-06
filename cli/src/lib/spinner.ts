/**
 * Stderr-based spinner for CLI output
 *
 * Unlike @clack/prompts spinner which writes to stdout,
 * this writes to stderr so stdout remains clean for piping.
 */

import chalk from "chalk";

const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"];
const SPINNER_INTERVAL = 80;

export interface Spinner {
  start(message?: string): void;
  stop(message?: string): void;
  message(message: string): void;
}

/**
 * Create a spinner that writes to stderr
 * This keeps stdout clean for machine-readable output
 */
export function createSpinner(): Spinner {
  let intervalId: NodeJS.Timeout | null = null;
  let frameIndex = 0;
  let currentMessage = "";

  const clearLine = () => {
    process.stderr.write("\r\x1b[K");
  };

  const render = () => {
    const frame = chalk.cyan(SPINNER_FRAMES[frameIndex]);
    clearLine();
    process.stderr.write(`${frame}  ${currentMessage}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  return {
    start(message = "") {
      currentMessage = message;
      frameIndex = 0;
      render();
      intervalId = setInterval(render, SPINNER_INTERVAL);
    },

    stop(message?: string) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearLine();
      if (message) {
        // Use checkmark for success messages, otherwise neutral
        const icon = message.includes("✓") || message.includes("success") || message.includes("complete")
          ? chalk.green("◇")
          : chalk.cyan("◇");
        process.stderr.write(`${icon}  ${message}\n`);
      }
    },

    message(message: string) {
      currentMessage = message;
    },
  };
}

/**
 * Spinner singleton for simple usage
 * Usage: spinner.start("Loading..."); spinner.stop("Done");
 */
export const spinner = {
  _instance: null as Spinner | null,

  start(message?: string) {
    this._instance = createSpinner();
    this._instance.start(message);
  },

  stop(message?: string) {
    if (this._instance) {
      this._instance.stop(message);
      this._instance = null;
    }
  },

  message(message: string) {
    if (this._instance) {
      this._instance.message(message);
    }
  },
};
