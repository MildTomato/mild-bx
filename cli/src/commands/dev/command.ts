/**
 * Dev command specification
 */

import {
  profileOption,
  verboseOption,
  jsonOption,
  dryRunOption,
} from "@/util/commands/arg-common.js";
import type { Command } from "@/util/commands/types.js";

export const devCommand = {
  name: "dev",
  aliases: [],
  description: "Watcher that auto syncs changes to hosted environment [long-running]",
  arguments: [],
  options: [
    { ...profileOption },
    {
      name: "debounce",
      shorthand: null,
      type: String,
      argument: "MS",
      deprecated: false,
      description: "Debounce interval for file changes (e.g., 500ms, 1s)",
    },
    {
      name: "types-interval",
      shorthand: null,
      type: String,
      argument: "INTERVAL",
      deprecated: false,
      description: "Interval for regenerating types (e.g., 30s, 1m)",
    },
    {
      name: "no-branch-watch",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Disable git branch watching",
    },
    {
      name: "seed",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Run seed files after schema sync (also re-seeds on schema changes)",
    },
    {
      name: "no-seed",
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: "Disable seeding even if enabled in config",
    },
    { ...dryRunOption, description: "Show what would be synced without applying" },
    { ...verboseOption, description: "Show detailed pg-delta logging" },
    { ...jsonOption, description: "Output as JSON (events as newline-delimited JSON)" },
  ],
  examples: [
    {
      name: "Start development watcher",
      value: "supa dev",
    },
    {
      name: "Watch with specific profile",
      value: "supa dev --profile staging",
    },
    {
      name: "Preview changes without applying",
      value: "supa dev --dry-run",
    },
    {
      name: "Watch with automatic seeding",
      value: "supa dev --seed",
    },
  ],
} as const satisfies Command;
