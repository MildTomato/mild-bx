/**
 * Parser for Supabase-generated TypeScript database types.
 * Extracts table/column definitions using string parsing (no ts-morph dependency).
 */

export interface ParsedField {
  name: string;
  /** Raw TypeScript type string, e.g. "string | null" */
  tsType: string;
  /** Has `?:` in definition (Insert/Update optionals) */
  optional: boolean;
  /** Includes `| null` */
  nullable: boolean;
  /** Core type without null/undefined/array modifiers */
  baseType: string;
}

export interface ParsedTable {
  name: string;
  row: ParsedField[];
  insert: ParsedField[];
  update: ParsedField[];
}

export interface ParsedEnum {
  name: string;
  values: string[];
}

export interface ParsedSchema {
  name: string;
  tables: ParsedTable[];
  enums: ParsedEnum[];
}

export interface ParsedDatabase {
  schemas: ParsedSchema[];
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Find the index just before the matching closing `}`, starting from the
 * position of the opening `{` (openIndex).
 */
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

/**
 * Extract the inner content of the first `SectionName: { ... }` block found
 * within `block`.
 */
function extractSection(block: string, sectionName: string): string | null {
  const re = new RegExp(`${sectionName}\\s*:\\s*\\{`);
  const match = re.exec(block);
  if (!match) return null;
  const openIndex = block.indexOf("{", match.index + match[0].length - 1);
  const closeIndex = findMatchingBrace(block, openIndex);
  return block.slice(openIndex + 1, closeIndex);
}

// ---------------------------------------------------------------------------
// Field parser
// ---------------------------------------------------------------------------

/**
 * Map a raw TypeScript type string to its base type (no null/undefined/[]).
 */
function extractBaseType(raw: string): string {
  return raw
    .replace(/\s*\|\s*null\b/g, "")
    .replace(/\s*\|\s*undefined\b/g, "")
    .replace(/\[\]\s*$/, "")
    .trim();
}

function parseFieldsBlock(block: string | null): ParsedField[] {
  if (!block) return [];

  const fields: ParsedField[] = [];
  // Match lines like:  id: number   or  text?: string | null | undefined
  const fieldRe = /^\s{1,}(\w+)(\?)?\s*:\s*(.+)/gm;
  let m: RegExpExecArray | null;

  while ((m = fieldRe.exec(block)) !== null) {
    const name = m[1];
    // Skip TypeScript-generated internal keys
    if (name === "Row" || name === "Insert" || name === "Update" || name === "Relationships") continue;

    const optional = m[2] === "?";
    // Strip trailing semicolons/commas
    const tsType = m[3].replace(/[;,]\s*$/, "").trim();

    const nullable = /\|\s*null\b/.test(tsType);
    const baseType = extractBaseType(tsType);

    fields.push({ name, tsType, optional, nullable, baseType });
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Tables parser
// ---------------------------------------------------------------------------

function parseTablesBlock(schemaBlock: string): ParsedTable[] {
  const tablesSection = extractSection(schemaBlock, "Tables");
  if (!tablesSection) return [];

  const tables: ParsedTable[] = [];
  // Match each table entry: "tableName: {"
  const tableRe = /^\s{1,}(\w+)\s*:\s*\{/gm;
  let m: RegExpExecArray | null;

  const SKIP_NAMES = new Set(["Row", "Insert", "Update", "Relationships", "Views", "Functions", "Enums", "CompositeTypes"]);

  while ((m = tableRe.exec(tablesSection)) !== null) {
    const tableName = m[1];
    if (SKIP_NAMES.has(tableName)) continue;
    const openIndex = tablesSection.indexOf("{", m.index + m[0].length - 1);
    const closeIndex = findMatchingBrace(tablesSection, openIndex);
    const tableBlock = tablesSection.slice(openIndex + 1, closeIndex);

    const row = parseFieldsBlock(extractSection(tableBlock, "Row"));
    const insert = parseFieldsBlock(extractSection(tableBlock, "Insert"));
    const update = parseFieldsBlock(extractSection(tableBlock, "Update"));

    tables.push({ name: tableName, row, insert, update });
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Enums parser
// ---------------------------------------------------------------------------

function parseEnumsBlock(schemaBlock: string): ParsedEnum[] {
  const enumsSection = extractSection(schemaBlock, "Enums");
  if (!enumsSection) return [];

  const enums: ParsedEnum[] = [];
  const enumRe = /^\s{1,}(\w+)\s*:\s*(.+)/gm;
  let m: RegExpExecArray | null;

  while ((m = enumRe.exec(enumsSection)) !== null) {
    const name = m[1];
    const valuesStr = m[2];
    const values: string[] = [];
    const valueRe = /"([^"]+)"/g;
    let vm: RegExpExecArray | null;
    while ((vm = valueRe.exec(valuesStr)) !== null) {
      values.push(vm[1]);
    }
    if (values.length > 0) {
      enums.push({ name, values });
    }
  }

  return enums;
}

// ---------------------------------------------------------------------------
// Top-level parser
// ---------------------------------------------------------------------------

/**
 * Parse a Supabase-generated `database.ts` source string into structured data.
 */
export function parseDatabaseTypes(source: string): ParsedDatabase {
  const schemas: ParsedSchema[] = [];

  // Find the Database type body
  const dbMatch = /export\s+type\s+Database\s*=\s*\{/.exec(source);
  if (!dbMatch) return { schemas };

  const dbOpen = source.indexOf("{", dbMatch.index + dbMatch[0].length - 1);
  const dbClose = findMatchingBrace(source, dbOpen);
  const dbBody = source.slice(dbOpen + 1, dbClose);

  // Each schema is a top-level key in the Database type: "public: {"
  const schemaRe = /^\s{1,}(\w+)\s*:\s*\{/gm;
  let m: RegExpExecArray | null;

  while ((m = schemaRe.exec(dbBody)) !== null) {
    const schemaName = m[1];
    const openIndex = dbBody.indexOf("{", m.index + m[0].length - 1);
    const closeIndex = findMatchingBrace(dbBody, openIndex);
    const schemaBlock = dbBody.slice(openIndex + 1, closeIndex);

    schemas.push({
      name: schemaName,
      tables: parseTablesBlock(schemaBlock),
      enums: parseEnumsBlock(schemaBlock),
    });
  }

  return { schemas };
}
