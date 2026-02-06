/**
 * Command registry - exports all commands and their specs
 */

import type { Command, CommandHandler } from "@/util/commands/types.js";

// Import commands
import init, { initCommand } from "./init/index.js";
import dev, { devCommand } from "./dev/index.js";
import orgs, { orgsCommand } from "./orgs/index.js";
import projects, { projectsCommand } from "./projects/index.js";
import project, { projectCommand } from "./project/index.js";
import login, { loginCommand } from "./login/index.js";
import logout, { logoutCommand } from "./logout/index.js";

// Command entries with spec and handler
interface CommandEntry {
  spec: Command;
  handler: CommandHandler;
}

// All top-level commands
const commandEntries: CommandEntry[] = [
  { spec: loginCommand, handler: login },
  { spec: logoutCommand, handler: logout },
  { spec: initCommand, handler: init },
  { spec: devCommand, handler: dev },
  { spec: orgsCommand, handler: orgs },
  { spec: projectsCommand, handler: projects },
  { spec: projectCommand, handler: project },
];

// Build command map (name + aliases → handler)
export const commands = new Map<string, CommandEntry>();

for (const entry of commandEntries) {
  // Register by name
  commands.set(entry.spec.name, entry);

  // Register by aliases
  for (const alias of entry.spec.aliases) {
    commands.set(alias, entry);
  }
}

// Export all command names for help/suggestions
export const commandNames = Array.from(new Set(commandEntries.map((e) => e.spec.name)));

// Export all command specs for documentation generation
export const commandSpecs = commandEntries.map((e) => e.spec);

// Get command by name or alias
export function getCommand(name: string): CommandEntry | undefined {
  return commands.get(name);
}

// Get similar commands for suggestions (basic Levenshtein-like matching)
export function suggestCommand(input: string): string[] {
  const suggestions: string[] = [];
  const inputLower = input.toLowerCase();

  for (const name of commandNames) {
    const nameLower = name.toLowerCase();

    // Exact prefix match
    if (nameLower.startsWith(inputLower) || inputLower.startsWith(nameLower)) {
      suggestions.push(name);
      continue;
    }

    // Simple character overlap check
    let matches = 0;
    for (const char of inputLower) {
      if (nameLower.includes(char)) matches++;
    }
    if (matches >= Math.min(3, inputLower.length)) {
      suggestions.push(name);
    }
  }

  return suggestions.slice(0, 3);
}
