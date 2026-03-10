/**
 * Feature registry - maps enabled features to their required environment variables.
 * Derives feature requirements from the config schema JSON.
 */
import type { ProjectConfig } from "./types.js";
import { configPathToEnvVar, getNestedValue } from "./env-var-mapping.js";
import configSchema from "../config-schema/config.schema.json";

export interface FeatureVariable {
  configPath: string;
  canonicalName: string;
  secret: boolean;
  required: boolean;
}

export interface FeatureRequirement {
  displayName: string;
  enabledPath: string;
  variables: FeatureVariable[];
}


/**
 * Build feature registry from the config schema.
 * Registers auth external providers and SMTP as features with required variables.
 */
export function buildFeatureRegistry(
  schema?: Record<string, unknown>
): FeatureRequirement[] {
  const schemaObj = schema ?? (configSchema as unknown as Record<string, unknown>);
  if (!schemaObj) return [];

  const features: FeatureRequirement[] = [];

  // Register auth external providers
  const externalProviders = getNestedValue(
    schemaObj,
    "properties.auth.properties.external.properties"
  ) as Record<string, unknown> | undefined;

  if (externalProviders) {
    for (const providerKey of Object.keys(externalProviders)) {
      const providerSchema = externalProviders[providerKey] as Record<
        string,
        unknown
      >;
      const properties = (providerSchema?.properties ?? {}) as Record<
        string,
        unknown
      >;

      const displayName =
        providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
      const basePath = `auth.external.${providerKey}`;

      const variables: FeatureVariable[] = [];

      for (const fieldKey of Object.keys(properties)) {
        if (fieldKey === "enabled" || fieldKey === "skip_nonce_check") continue;

        const configPath = `${basePath}.${fieldKey}`;
        const fieldSchema = properties[fieldKey] as Record<string, unknown>;
        const isSecret = fieldSchema?.secret === true;
        const isRequired = fieldSchema?.required === true;

        variables.push({
          configPath,
          canonicalName: configPathToEnvVar(configPath),
          secret: isSecret,
          required: isRequired,
        });
      }

      features.push({
        displayName: `${displayName} OAuth`,
        enabledPath: `${basePath}.enabled`,
        variables,
      });
    }
  }

  // Register SMTP as a feature
  const smtpProperties = getNestedValue(
    schemaObj,
    "properties.auth.properties.email.properties.smtp.properties"
  ) as Record<string, unknown> | undefined;

  if (smtpProperties) {
    const variables: FeatureVariable[] = [];

    for (const fieldKey of Object.keys(smtpProperties)) {
      if (fieldKey === "enabled") continue;

      const configPath = `auth.email.smtp.${fieldKey}`;
      const fieldSchema = smtpProperties[fieldKey] as Record<string, unknown>;
      const isSecret = fieldSchema?.secret === true;
      const isRequired = fieldSchema?.required === true;

      variables.push({
        configPath,
        canonicalName: configPathToEnvVar(configPath),
        secret: isSecret,
        required: isRequired,
      });
    }

    features.push({
      displayName: "SMTP Email",
      enabledPath: "auth.email.smtp.enabled",
      variables,
    });
  }

  return features;
}

// Cached registry instance
let _registry: FeatureRequirement[] | null = null;

function getRegistry(): FeatureRequirement[] {
  if (!_registry) {
    _registry = buildFeatureRegistry();
  }
  return _registry;
}

/**
 * Get features that are enabled in the given config
 */
export function getEnabledFeatures(
  config: ProjectConfig
): FeatureRequirement[] {
  const registry = getRegistry();
  return registry.filter((feature) => {
    const enabled = getNestedValue(config, feature.enabledPath);
    return enabled === true;
  });
}

/**
 * Get flat deduplicated list of all required variables for enabled features
 */
export function getRequiredVariables(
  config: ProjectConfig
): FeatureVariable[] {
  const features = getEnabledFeatures(config);
  const seen = new Set<string>();
  const result: FeatureVariable[] = [];

  for (const feature of features) {
    for (const variable of feature.variables) {
      if (variable.required && !seen.has(variable.configPath)) {
        seen.add(variable.configPath);
        result.push(variable);
      }
    }
  }

  return result;
}

/**
 * Get all sensitive (secret) fields from the registry.
 * Replaces the hardcoded SENSITIVE_FIELDS list.
 */
export function getSensitiveFields(): FeatureVariable[] {
  const registry = getRegistry();
  const seen = new Set<string>();
  const result: FeatureVariable[] = [];

  for (const feature of registry) {
    for (const variable of feature.variables) {
      if (variable.secret && !seen.has(variable.configPath)) {
        seen.add(variable.configPath);
        result.push(variable);
      }
    }
  }

  return result;
}

/**
 * Quick lookup: config path -> canonical name
 */
export function getCanonicalNameForConfigPath(
  configPath: string
): string | undefined {
  const registry = getRegistry();
  for (const feature of registry) {
    for (const variable of feature.variables) {
      if (variable.configPath === configPath) {
        return variable.canonicalName;
      }
    }
  }
  return undefined;
}
