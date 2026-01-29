/**
 * Shared config diff display component
 */

import React from "react";
import { Box, Text } from "ink";
import { formatDiff, type ConfigDiff } from "../lib/sync.js";

interface ConfigDiffListProps {
  title: string;
  diffs: ConfigDiff[];
  marginTop?: number;
}

/**
 * Render a single config diff line
 */
export function ConfigDiffLine({ diff }: { diff: ConfigDiff }) {
  const formatted = formatDiff(diff);
  return (
    <Text>
      {"  "}
      <Text color="cyan">~</Text> {diff.key}:{" "}
      <Text dimColor>{formatted.old}</Text> <Text color="yellow">→</Text>{" "}
      <Text color="green">{formatted.new}</Text>
    </Text>
  );
}

/**
 * Render a list of config diffs with a title
 */
export function ConfigDiffList({
  title,
  diffs,
  marginTop = 0,
}: ConfigDiffListProps) {
  if (diffs.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text dimColor>{title}:</Text>
      {diffs.map((diff) => (
        <ConfigDiffLine key={diff.key} diff={diff} />
      ))}
    </Box>
  );
}

interface ConfigDiffSummaryProps {
  postgrestDiffs: ConfigDiff[];
  authDiffs: ConfigDiff[];
  hasMigrations?: boolean;
}

/**
 * Render full config diff summary (API + Auth settings)
 */
export function ConfigDiffSummary({
  postgrestDiffs,
  authDiffs,
  hasMigrations = false,
}: ConfigDiffSummaryProps) {
  const postgrestChanges = postgrestDiffs.filter((d) => d.changed);
  const authChanges = authDiffs.filter((d) => d.changed);

  return (
    <>
      <ConfigDiffList
        title="API Settings"
        diffs={postgrestChanges}
        marginTop={hasMigrations ? 1 : 0}
      />
      <ConfigDiffList
        title="Auth Settings"
        diffs={authChanges}
        marginTop={postgrestChanges.length > 0 ? 1 : 0}
      />
    </>
  );
}
