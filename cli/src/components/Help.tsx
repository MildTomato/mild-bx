/**
 * Reusable Help component for CLI help screens
 * Renders help output using Ink for proper TTY detection
 */

import React from "react";
import { Box, Text, Newline } from "ink";

interface Option {
  short?: string;
  long: string;
  description: string;
  argument?: string;
}

interface Command {
  name: string;
  description: string;
}

export interface ProjectContext {
  projectRef?: string;
  branch: string;
  profileName?: string;
}

interface HelpProps {
  description: string;
  usage: string;
  options?: Option[];
  commands?: Command[];
  examples?: string[];
  context?: ProjectContext | null;
  next?: string;
  footer?: string;
}

export function Help({
  description,
  usage,
  options = [],
  commands = [],
  examples = [],
  context,
  next,
  footer,
}: HelpProps) {
  // Calculate column widths for alignment
  const optionWidth = Math.max(
    ...options.map((o) => {
      const flags = [o.short, o.long].filter(Boolean).join(", ");
      const arg = o.argument ? ` ${o.argument}` : "";
      return flags.length + arg.length;
    }),
    0
  );

  const commandWidth = Math.max(
    ...commands.map((c) => c.name.length),
    0
  );

  return (
    <Box flexDirection="column" paddingTop={1}>
      {/* Context */}
      {context === null ? (
        <Text dimColor>No project configured. Run <Text color="white">supa init</Text> to get started.</Text>
      ) : context ? (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>Project:</Text>    <Text color="cyan">{context.projectRef}</Text>
          </Text>
          <Text>
            <Text dimColor>Git Branch:</Text> <Text color="yellow">{context.branch}</Text>
          </Text>
          {context.profileName && (
            <Text>
              <Text dimColor>Profile:</Text>    <Text color="cyan">{context.profileName}</Text>
            </Text>
          )}
        </Box>
      ) : null}

      {/* Usage */}
      <Box marginTop={1}>
        <Text>Usage: {usage}</Text>
      </Box>

      {/* Description */}
      <Box marginTop={1}>
        <Text>{description}</Text>
      </Box>

      {/* Options */}
      {options.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Options:</Text>
          {options.map((option) => {
            const flags = [option.short, option.long].filter(Boolean).join(", ");
            const arg = option.argument ? ` ${option.argument}` : "";
            const label = flags + arg;
            const padding = " ".repeat(Math.max(optionWidth - label.length + 2, 2));

            return (
              <Text key={option.long}>
                {"  "}{label}{padding}{option.description}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Commands */}
      {commands.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Commands:</Text>
          {commands.map((command) => {
            const padding = " ".repeat(Math.max(commandWidth - command.name.length + 2, 2));

            return (
              <Text key={command.name}>
                {"  "}{command.name}{padding}{command.description}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Examples */}
      {examples.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Examples:</Text>
          {examples.map((example, i) => (
            <Text key={i}>{"  "}{example}</Text>
          ))}
        </Box>
      )}

      {/* Next */}
      {next && (
        <Box marginTop={1}>
          <Text dimColor>{next}</Text>
        </Box>
      )}

      {/* Footer */}
      {footer && (
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      )}

      {/* Trailing blank line */}
      <Newline />
    </Box>
  );
}
