import React from "react";
import { Box, Text } from "ink";

interface OutputProps {
  children: React.ReactNode;
}

/**
 * Wrapper for CLI output that adds consistent top/bottom spacing.
 * Use this to wrap your command output for consistent padding.
 */
export function Output({ children }: OutputProps) {
  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      {children}
    </Box>
  );
}

/**
 * Renders a blank line for spacing between sections.
 */
export function BlankLine() {
  return <Text> </Text>;
}
