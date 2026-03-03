/**
 * Generate extended config schema
 * Imports base schema from external/config-schema and adds CLI-specific properties
 */

import { s } from "jsonv-ts";
import { schema as baseSchema } from "../../external/config-schema/src/base.ts";
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
    ...baseSchemaJson.properties,
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
