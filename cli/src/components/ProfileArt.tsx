import React from "react";
import { Text, Box } from "ink";
import type { WorkflowProfileDefinition } from "../lib/workflow-profiles.js";

interface ProfileArtProps {
  profile: WorkflowProfileDefinition;
  /** Hide the "name - title" header */
  hideHeader?: boolean;
  /** Hide the description below the diagram */
  hideDescription?: boolean;
}

/**
 * Renders a workflow profile with header, colored diagram, and description.
 *
 * Colors environment boxes based on keywords:
 * - "local" → yellow
 * - "preview" → blue
 * - "staging" → cyan
 * - "production" → red
 */
export function ProfileArt({ profile, hideHeader, hideDescription }: ProfileArtProps) {
  const lines = profile.art.split("\n").filter((line) => line.trim() !== "");

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {!hideHeader && (
        <Box>
          <Text bold>{profile.name}</Text>
          <Text dimColor> - "{profile.title}"</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={hideHeader ? 0 : 1}>
        {lines.map((line, i) => {
          // Lines with boxes - color by environment type
          if (line.includes("▓")) {
            const parts = line.split(/(▓[^▓]*▓)/g);
            return (
              <Text key={i}>
                {parts.map((part, j) => {
                  if (!part.includes("▓")) return <Text key={j}>{part}</Text>;

                  const content = part.toLowerCase();
                  let color: string;
                  if (content.includes("local")) {
                    color = "yellow";
                  } else if (
                    content.includes("production") ||
                    content.includes("prod")
                  ) {
                    color = "red";
                  } else if (content.includes("staging")) {
                    color = "cyan";
                  } else if (content.includes("preview")) {
                    color = "blue";
                  } else {
                    color = "white";
                  }

                  return (
                    <Text key={j} color={color}>
                      {part}
                    </Text>
                  );
                })}
              </Text>
            );
          }
          // Other lines (like branch names, arrows) - default color
          return <Text key={i}>{line}</Text>;
        })}
      </Box>
      {!hideDescription && (
        <Box marginTop={1}>
          <Text dimColor>{profile.description}</Text>
        </Box>
      )}
    </Box>
  );
}
