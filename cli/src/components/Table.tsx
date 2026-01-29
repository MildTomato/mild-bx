import React from "react";
import { Text, Box } from "ink";

interface Column {
  key: string;
  header: string;
  width?: number;
}

interface TableProps {
  columns: Column[];
  data: Record<string, string | number | boolean>[];
}

export function Table({ columns, data }: TableProps) {
  // Calculate column widths
  const widths = columns.map((col) => {
    if (col.width) return col.width;

    let maxWidth = col.header.length;
    for (const row of data) {
      const val = String(row[col.key] ?? "");
      maxWidth = Math.max(maxWidth, val.length);
    }
    return Math.min(maxWidth + 2, 40);
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        {columns.map((col, i) => (
          <Box key={col.key} width={widths[i]}>
            <Text bold color="cyan">
              {col.header}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Box>
        {columns.map((col, i) => (
          <Box key={col.key} width={widths[i]}>
            <Text dimColor>{"─".repeat(widths[i] - 1)}</Text>
          </Box>
        ))}
      </Box>

      {/* Data rows */}
      {data.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {columns.map((col, i) => (
            <Box key={col.key} width={widths[i]}>
              <Text>{String(row[col.key] ?? "")}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
