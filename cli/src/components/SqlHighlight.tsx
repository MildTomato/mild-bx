/**
 * SQL Syntax Highlighting for Ink CLI
 */

import React from "react";
import { Text, Box } from "ink";

// SQL keywords to highlight
const KEYWORDS = new Set([
  "CREATE",
  "TABLE",
  "IF",
  "NOT",
  "EXISTS",
  "PRIMARY",
  "KEY",
  "REFERENCES",
  "ON",
  "DELETE",
  "CASCADE",
  "DEFAULT",
  "UNIQUE",
  "INDEX",
  "USING",
  "ALTER",
  "ADD",
  "DROP",
  "COLUMN",
  "CONSTRAINT",
  "FOREIGN",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "WHERE",
  "SELECT",
  "FROM",
  "ENABLE",
  "ROW",
  "LEVEL",
  "SECURITY",
  "POLICY",
  "FOR",
  "TO",
  "WITH",
  "CHECK",
  "FUNCTION",
  "RETURNS",
  "AS",
  "BEGIN",
  "END",
  "RETURN",
  "LANGUAGE",
  "TRIGGER",
  "BEFORE",
  "AFTER",
  "EACH",
  "EXECUTE",
  "PROCEDURE",
  "GRANT",
  "REVOKE",
  "ALL",
  "PRIVILEGES",
  "ROLE",
  "PUBLIC",
  "AND",
  "OR",
  "IN",
  "IS",
  "NULL",
  "TRUE",
  "FALSE",
  "USING",
  "REPLACE",
  "VIEW",
  "MATERIALIZED",
  "EXTENSION",
  "SCHEMA",
  "TYPE",
  "ENUM",
  "DOMAIN",
  "SEQUENCE",
  "OWNED",
  "BY",
  "NEW",
  "OLD",
  "DECLARE",
  "RAISE",
  "EXCEPTION",
  "NOTICE",
]);

// Data types to highlight differently
const TYPES = new Set([
  "UUID",
  "TEXT",
  "VARCHAR",
  "CHAR",
  "INTEGER",
  "INT",
  "BIGINT",
  "SMALLINT",
  "BOOLEAN",
  "BOOL",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE",
  "TIME",
  "TIMETZ",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "DOUBLE",
  "PRECISION",
  "SERIAL",
  "BIGSERIAL",
  "JSON",
  "JSONB",
  "BYTEA",
  "ARRAY",
  "INTERVAL",
  "MONEY",
  "INET",
  "CIDR",
  "PLPGSQL",
  "SQL",
]);

interface SqlHighlightProps {
  sql: string;
  maxLines?: number;
}

/**
 * Highlight a single SQL token
 */
function highlightToken(token: string, index: number): React.ReactNode {
  const upper = token.toUpperCase();

  // Keywords in blue
  if (KEYWORDS.has(upper)) {
    return (
      <Text key={index} color="blue">
        {token}
      </Text>
    );
  }

  // Types in cyan
  if (TYPES.has(upper)) {
    return (
      <Text key={index} color="cyan">
        {token}
      </Text>
    );
  }

  // Strings in green
  if (token.startsWith("'") || token.startsWith('"')) {
    return (
      <Text key={index} color="green">
        {token}
      </Text>
    );
  }

  // Comments in dim
  if (token.startsWith("--")) {
    return (
      <Text key={index} dimColor>
        {token}
      </Text>
    );
  }

  // Numbers in yellow
  if (/^\d+$/.test(token)) {
    return (
      <Text key={index} color="yellow">
        {token}
      </Text>
    );
  }

  // Function calls in magenta (word followed by paren)
  if (/^\w+\(/.test(token)) {
    const funcName = token.match(/^(\w+)/)?.[1] || "";
    const rest = token.slice(funcName.length);
    return (
      <Text key={index}>
        <Text color="magenta">{funcName}</Text>
        {rest}
      </Text>
    );
  }

  return <Text key={index}>{token}</Text>;
}

/**
 * Tokenize SQL for highlighting
 */
function tokenizeSql(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    // Handle comments
    if (!inString && char === "-" && line[i + 1] === "-") {
      if (current) tokens.push(current);
      tokens.push(line.slice(i));
      return tokens;
    }

    // Handle strings
    if ((char === "'" || char === '"') && line[i - 1] !== "\\") {
      if (!inString) {
        if (current) tokens.push(current);
        current = char;
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        current += char;
        tokens.push(current);
        current = "";
        inString = false;
      } else {
        current += char;
      }
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    // Handle word boundaries
    if (/\s/.test(char) || /[(),;]/.test(char)) {
      if (current) tokens.push(current);
      tokens.push(char);
      current = "";
    } else {
      current += char;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Render a SQL line with syntax highlighting
 */
function SqlLine({ line }: { line: string }) {
  const tokens = tokenizeSql(line);
  return <Text>{tokens.map((token, i) => highlightToken(token, i))}</Text>;
}

/**
 * SQL Syntax Highlighting component
 */
export function SqlHighlight({ sql, maxLines }: SqlHighlightProps) {
  let lines = sql.split("\n");

  // Limit lines if specified
  const truncated = maxLines && lines.length > maxLines;
  if (truncated) {
    lines = lines.slice(0, maxLines);
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <SqlLine key={i} line={line} />
      ))}
      {truncated && (
        <Text dimColor>
          {" "}
          ... ({sql.split("\n").length - maxLines!} more lines)
        </Text>
      )}
    </Box>
  );
}

/**
 * Schema file display with path and highlighted content
 */
export function SchemaFileDisplay({
  path,
  content,
  maxLines = 10,
}: {
  path: string;
  content: string;
  maxLines?: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        {path}
      </Text>
      <Box marginLeft={2}>
        <SqlHighlight sql={content} maxLines={maxLines} />
      </Box>
    </Box>
  );
}
