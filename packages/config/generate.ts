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
