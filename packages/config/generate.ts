/**
 * Generate extended config schema
 * Imports base schema from external/config-schema and adds CLI-specific properties
 */

import { s } from "jsonv-ts";
import { schema as baseSchema } from "../../external/config-schema/src/base.ts";
import { getFieldMeta } from "./src/config-field-meta.js";
import { WORKFLOW_PROFILE_VALUES } from "./src/workflow-profiles.js";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Define our CLI-specific profile schema
const profileSchema = s
  .strictObject({
    mode: s.string({
      enum: ["local", "preview", "remote"],
      description: "The mode for this profile",
    }),
    workflow: s.string({
      enum: ["git", "dashboard"],
      description: "The workflow type for this profile",
    }),
    schema: s.string({
      enum: ["declarative", "migrations"],
      description: "The schema management approach",
    }),
    branches: s.array(s.string(), {
      description: "Git branch patterns that match this profile",
    }),
    project: s.string({
      description: "Override project ID for this profile",
    }),
  })
  .partial();

/**
 * Recursively walk schema properties and annotate each with its scope.
 * Uses dot-notation paths to look up scope from config-field-meta.
 * For additionalProperties sections (dynamic keys like functions.*), uses
 * the wildcard path.
 */
function annotateScope(
  properties: Record<string, any>,
  prefix = ""
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const node = { ...value };

    // Annotate this property with its metadata
    const meta = getFieldMeta(path);
    node.scope = meta.scope;
    node.promotable = meta.promotable;
    node.secret = meta.secret;
    node.required = meta.required;

    // Recurse into nested properties
    if (node.properties) {
      node.properties = annotateScope(node.properties, path);
    }

    // Recurse into additionalProperties (dynamic keys like functions.*, buckets.*)
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
      const wildcardPath = `${path}.*`;
      const apNode = { ...node.additionalProperties };
      const apMeta = getFieldMeta(wildcardPath);
      apNode.scope = apMeta.scope;
      apNode.promotable = apMeta.promotable;
      apNode.secret = apMeta.secret;
      apNode.required = apMeta.required;
      if (apNode.properties) {
        apNode.properties = annotateScope(apNode.properties, wildcardPath);
      }
      node.additionalProperties = apNode;
    }

    result[key] = node;
  }

  return result;
}

// Get base schema properties
const baseSchemaJson = baseSchema.toJSON();

// Extend the base schema with our CLI-specific properties
const extendedSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: {
      type: "string",
      description: "JSON Schema reference for editor support",
    },
    ...annotateScope(baseSchemaJson.properties),
    workflow_profile: {
      type: "string",
      description: "The workflow profile to use for this project.",
      enum: [...WORKFLOW_PROFILE_VALUES],
      scope: "global",
      promotable: false,
      secret: false,
      required: false,
    },
    schema_management: {
      type: "string",
      description: "The schema management approach for this project.",
      enum: ["declarative", "migrations"],
      scope: "global",
      promotable: false,
      secret: false,
      required: false,
    },
    config_source: {
      type: "string",
      description: "The source of truth for project configuration.",
      enum: ["code", "remote"],
      scope: "global",
      promotable: false,
      secret: false,
      required: false,
    },
    production_branch: {
      type: "string",
      description: "The Git branch to treat as the production branch.",
      scope: "global",
      promotable: false,
      secret: false,
      required: false,
    },
    hooks: {
      type: "object",
      description: "Shell commands to run at specific points in the CLI lifecycle.",
      additionalProperties: false,
      properties: {
        pre_push: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              additionalProperties: false,
              required: ["command"],
              properties: {
                command: { type: "string", description: "Shell command to run." },
                watch: { type: "string", description: "Glob pattern of files to watch in dev mode." },
              },
            },
            {
              type: "array",
              items: {
                oneOf: [
                  { type: "string" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["command"],
                    properties: {
                      command: { type: "string", description: "Shell command to run." },
                      watch: { type: "string", description: "Glob pattern of files to watch in dev mode." },
                    },
                  },
                ],
              },
            },
          ],
          description: "Hook(s) to run before push and dev schema operations (e.g., ORM codegen).",
        },
        pre_pull: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              additionalProperties: false,
              required: ["command"],
              properties: {
                command: { type: "string", description: "Shell command to run." },
                watch: { type: "string", description: "Glob pattern of files to watch in dev mode." },
              },
            },
            {
              type: "array",
              items: {
                oneOf: [
                  { type: "string" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["command"],
                    properties: {
                      command: { type: "string", description: "Shell command to run." },
                      watch: { type: "string", description: "Glob pattern of files to watch in dev mode." },
                    },
                  },
                ],
              },
            },
          ],
          description: "Hook(s) to run before pull operations.",
        },
      },
    },
    codegen: {
      type: "object",
      description: "Code generation settings for type-safe database access.",
      additionalProperties: false,
      properties: {
        validation: {
          type: "string",
          enum: ["zod"],
          description: "Validation library to generate schemas for.",
        },
        plugins: {
          type: "array",
          items: { type: "string", enum: ["tanstack"] },
          description: "Additional code generation plugins.",
        },
        tanstack: {
          type: "object",
          description: "Options for the TanStack DB plugin.",
          additionalProperties: false,
          properties: {
            client_path: {
              type: "string",
              description: "Import path for the Supabase client. Defaults to \"@/lib/supabase/client\".",
            },
            client_function_name: {
              type: "string",
              description: "Name of the exported client function. Defaults to \"createClient\".",
            },
          },
        },
      },
    },
    profiles: {
      type: "object",
      description: "Profile configuration for different environments",
      additionalProperties: profileSchema.toJSON(),
    },
  },
};

// Write the extended schema
const outputPath = join(__dirname, "config-schema", "config.schema.json");
writeFileSync(outputPath, JSON.stringify(extendedSchema, null, 2));

console.log(`Extended schema written to ${outputPath}`);

// ---------------------------------------------------------------------------
// TypeScript interface generation from the extended schema
// ---------------------------------------------------------------------------

/**
 * Convert a dot-path segment or property key to a PascalCase interface name.
 * e.g. "auth_config" -> "AuthConfig", "pre_push" -> "PrePush"
 */
function toPascalCase(str: string): string {
  return str
    .split(/[_\-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Map a JSON Schema node to a TypeScript type string.
 * Collects interface definitions into `interfaces` as a side-effect.
 *
 * @param node        - The JSON Schema node
 * @param ifaceName   - The interface name to use if this node becomes an interface
 * @param interfaces  - Accumulator for interface declarations (in order)
 * @param emitted     - Set of already-emitted interface names (dedup guard)
 */
function schemaNodeToType(
  node: any,
  ifaceName: string,
  interfaces: string[],
  emitted: Set<string>
): string {
  if (!node || typeof node !== "object") return "unknown";

  // Handle oneOf → union type
  if (node.oneOf && Array.isArray(node.oneOf)) {
    const members = node.oneOf.map((variant: any, i: number) =>
      schemaNodeToType(variant, `${ifaceName}Variant${i}`, interfaces, emitted)
    );
    return members.join(" | ");
  }

  // Handle enum → string literal union
  if (node.enum && Array.isArray(node.enum)) {
    return node.enum.map((v: any) => JSON.stringify(v)).join(" | ");
  }

  const type = node.type;

  if (type === "string") return "string";
  if (type === "boolean") return "boolean | string";
  if (type === "number" || type === "integer") return "number";

  if (type === "array") {
    if (node.items) {
      const itemType = schemaNodeToType(
        node.items,
        `${ifaceName}Item`,
        interfaces,
        emitted
      );
      return `Array<${itemType}>`;
    }
    return "Array<unknown>";
  }

  if (type === "object" || node.properties || node.additionalProperties || node.patternProperties) {
    // patternProperties without own meaningful properties → Record
    if (node.patternProperties && (!node.properties || Object.keys(node.properties).length === 0)) {
      // Use the first (and typically only) patternProperties value schema
      const patternSchemas = Object.values(node.patternProperties) as any[];
      if (patternSchemas.length > 0) {
        const entryIfaceName = `${ifaceName}Entry`;
        const valueType = schemaNodeToType(patternSchemas[0], entryIfaceName, interfaces, emitted);
        return `Record<string, ${valueType}>`;
      }
      return "Record<string, unknown>";
    }

    // Pure additionalProperties without own properties → Record
    if (!node.properties && node.additionalProperties) {
      const valueType = schemaNodeToType(
        node.additionalProperties,
        ifaceName,
        interfaces,
        emitted
      );
      return `Record<string, ${valueType}>`;
    }

    // Has own properties — emit an interface
    if (node.properties) {
      if (!emitted.has(ifaceName)) {
        emitted.add(ifaceName);
        // node.required can be a JSON Schema array (standard) or a boolean
        // (annotated by annotateScope). Normalise to an array.
        const requiredFields: string[] = Array.isArray(node.required) ? node.required : [];
        const lines: string[] = [];

        for (const [propKey, propNode] of Object.entries<any>(node.properties)) {
          const childIfaceName = `${ifaceName}${toPascalCase(propKey)}`;
          const tsType = schemaNodeToType(
            propNode,
            childIfaceName,
            interfaces,
            emitted
          );
          const isRequired = requiredFields.includes(propKey);
          const optMark = isRequired ? "" : "?";
          const jsdoc =
            propNode.description
              ? `  /** ${propNode.description.replace(/\*\//g, "* /")} */\n`
              : "";
          lines.push(`${jsdoc}  ${propKey}${optMark}: ${tsType};`);
        }

        // If the object also accepts additionalProperties, add an index signature
        if (node.additionalProperties && typeof node.additionalProperties === "object") {
          const apIfaceName = `${ifaceName}Entry`;
          const apType = schemaNodeToType(
            node.additionalProperties,
            apIfaceName,
            interfaces,
            emitted
          );
          lines.push(`  [key: string]: ${apType} | undefined;`);
        }

        interfaces.push(`export interface ${ifaceName} {\n${lines.join("\n")}\n}`);
      }
      return ifaceName;
    }

    // Empty object
    return "Record<string, unknown>";
  }

  return "unknown";
}

/**
 * Generate the full `src/types.ts` content from the extended schema.
 */
function generateTypesFile(schema: any): string {
  const interfaces: string[] = [];
  const emitted = new Set<string>();

  // We'll collect top-level field types so we can build ProjectConfig last
  const topLevelFields: Array<{ key: string; tsType: string; required: boolean; description?: string }> = [];

  const properties = schema.properties as Record<string, any>;
  const schemaRequired: string[] = schema.required ?? [];

  for (const [key, node] of Object.entries<any>(properties)) {
    // $schema is a special meta-key — type as string, don't generate interface
    if (key === "$schema") {
      topLevelFields.push({ key, tsType: "string", required: false, description: node.description });
      continue;
    }

    // workflow_profile uses the imported WorkflowProfile type
    if (key === "workflow_profile") {
      const isRequired = schemaRequired.includes(key);
      topLevelFields.push({ key, tsType: "WorkflowProfile", required: isRequired, description: node.description });
      continue;
    }

    // schema_management uses the standalone SchemaManagement type alias
    if (key === "schema_management") {
      const isRequired = schemaRequired.includes(key);
      topLevelFields.push({ key, tsType: "SchemaManagement", required: isRequired, description: node.description });
      continue;
    }

    // config_source uses the standalone ConfigSource type alias
    if (key === "config_source") {
      const isRequired = schemaRequired.includes(key);
      topLevelFields.push({ key, tsType: "ConfigSource", required: isRequired, description: node.description });
      continue;
    }

    const ifaceName = toPascalCase(key) + "Config";
    const tsType = schemaNodeToType(node, ifaceName, interfaces, emitted);
    const isRequired = schemaRequired.includes(key);
    topLevelFields.push({ key, tsType, required: isRequired, description: node.description });
  }

  // Build ProjectConfig interface
  const projectConfigLines = topLevelFields.map(({ key, tsType, required, description }) => {
    const optMark = required ? "" : "?";
    const jsdoc = description ? `  /** ${description.replace(/\*\//g, "* /")} */\n` : "";
    return `${jsdoc}  ${key}${optMark}: ${tsType};`;
  });

  const projectConfigInterface = `export interface ProjectConfig {\n${projectConfigLines.join("\n")}\n}`;

  const header = `// AUTO-GENERATED — do not edit manually.
// Run: pnpm generate in packages/config to regenerate.
// Source: packages/config/generate.ts`;

  // WorkflowProfile is defined in workflow-profiles.ts and must be re-exported
  // so consumers importing from types.ts continue to get it.
  const imports = `import type { WorkflowProfile } from "./workflow-profiles.js";
export type { WorkflowProfile } from "./workflow-profiles.js";`;

  // Derive SchemaManagement values from the extended schema
  const schemaManagementValues: string[] = properties["schema_management"]?.enum ?? ["declarative", "migrations"];
  const schemaManagementType = `export type SchemaManagement = ${schemaManagementValues.map((v: string) => JSON.stringify(v)).join(" | ")};`;

  // Derive ConfigSource values from the extended schema
  const configSourceValues: string[] = properties["config_source"]?.enum ?? ["code", "remote"];
  const configSourceType = `export type ConfigSource = ${configSourceValues.map((v: string) => JSON.stringify(v)).join(" | ")};`;

  const sections = [
    header,
    "",
    imports,
    "",
    schemaManagementType,
    configSourceType,
    "",
    ...interfaces,
    "",
    projectConfigInterface,
    "",
    "/**",
    " * Config diff entry showing old and new values",
    " */",
    "export interface ConfigDiff {",
    "  key: string;",
    "  oldValue: unknown;",
    "  newValue: unknown;",
    "  changed: boolean;",
    "}",
  ];

  return sections.join("\n") + "\n";
}

const typesContent = generateTypesFile(extendedSchema);
const typesOutputPath = join(__dirname, "src", "types.ts");
writeFileSync(typesOutputPath, typesContent);
console.log(`TypeScript types written to ${typesOutputPath}`);
