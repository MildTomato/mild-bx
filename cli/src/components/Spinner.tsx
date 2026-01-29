import React from "react";
import { Text, Box } from "ink";
import InkSpinner from "ink-spinner";

interface SpinnerProps {
  message: string;
}

export function Spinner({ message }: SpinnerProps) {
  return (
    <Box>
      <Text color="blue">
        <InkSpinner type="dots" /> {message}
      </Text>
    </Box>
  );
}

interface StatusProps {
  type: "success" | "error" | "warning" | "info";
  message: string;
  details?: string;
}

export function Status({ type, message, details }: StatusProps) {
  const icons: Record<StatusProps["type"], string> = {
    success: "✓",
    error: "✗",
    warning: "!",
    info: "→",
  };

  const colors: Record<StatusProps["type"], string> = {
    success: "green",
    error: "red",
    warning: "yellow",
    info: "blue",
  };

  return (
    <Box flexDirection="column">
      <Text color={colors[type]}>
        {icons[type]} {message}
      </Text>
      {details && (
        <Box marginLeft={2}>
          <Text dimColor>{details}</Text>
        </Box>
      )}
    </Box>
  );
}
