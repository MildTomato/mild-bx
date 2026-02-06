/**
 * Provider registry and utilities for OAuth provider management
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExternalProviderConfig } from './config-types.js';

export type ProviderCategory = 'popular' | 'social' | 'enterprise';

export interface ProviderDefinition {
  key: string;
  displayName: string;
  apiPrefix: string;
  category: ProviderCategory;
  hasUrl?: boolean;
  requiresCredentials: boolean;
  aliases?: string[];
}

/**
 * Load providers from config schema (single source of truth)
 */
function loadProvidersFromSchema(): ProviderDefinition[] {
  try {
    // Try multiple paths to find the schema
    // 1. Relative to binary directory (for compiled mode)
    // 2. Relative to source directory (for dev mode)
    const binaryDir = dirname(process.execPath);
    const sourceDir = fileURLToPath(new URL('.', import.meta.url));

    const possiblePaths = [
      join(binaryDir, 'config-schema', 'config.schema.json'),
      join(sourceDir, '../../config-schema/config.schema.json'),
    ];

    let schema;
    for (const schemaPath of possiblePaths) {
      try {
        schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
        break;
      } catch {
        continue;
      }
    }

    if (!schema) {
      throw new Error('Could not find config.schema.json in any expected location');
    }

    const externalProviders = schema.properties?.auth?.properties?.external?.properties;
    if (!externalProviders) {
      throw new Error('Could not find auth.external providers in schema');
    }

    const providerKeys = Object.keys(externalProviders) as string[];

    // Categorize providers (matches UX design)
    const popular = ['google', 'github', 'apple'];
    const enterprise = ['azure', 'gitlab', 'keycloak', 'workos', 'bitbucket'];
    const providersWithUrl = ['azure', 'gitlab', 'keycloak', 'workos'];

    return providerKeys
      .sort((a, b) => {
        // Sort: popular first, then social, then enterprise
        const catA = popular.includes(a) ? 0 : enterprise.includes(a) ? 2 : 1;
        const catB = popular.includes(b) ? 0 : enterprise.includes(b) ? 2 : 1;
        if (catA !== catB) return catA - catB;
        return a.localeCompare(b);
      })
      .map(key => {
        // Determine category
        let category: ProviderCategory = 'social';
        if (popular.includes(key)) category = 'popular';
        else if (enterprise.includes(key)) category = 'enterprise';

        // Display name (special cases for proper capitalization)
        const displayName = key === 'azure' ? 'Azure AD'
                          : key === 'gitlab' ? 'GitLab'
                          : key === 'github' ? 'GitHub'
                          : key === 'linkedin' ? 'LinkedIn'
                          : key === 'workos' ? 'WorkOS'
                          : key.charAt(0).toUpperCase() + key.slice(1);

        return {
          key,
          displayName,
          apiPrefix: key,
          category,
          requiresCredentials: true, // All OAuth providers require credentials
          hasUrl: providersWithUrl.includes(key),
        };
      });
  } catch (err) {
    // Fallback to minimal set if schema loading fails
    console.error('Warning: Could not load providers from schema:', err);
    return [
      { key: 'google', displayName: 'Google', apiPrefix: 'google', category: 'popular', requiresCredentials: true },
      { key: 'github', displayName: 'GitHub', apiPrefix: 'github', category: 'popular', requiresCredentials: true },
      { key: 'apple', displayName: 'Apple', apiPrefix: 'apple', category: 'popular', requiresCredentials: true },
    ];
  }
}

/**
 * All supported OAuth providers, loaded from config schema
 */
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = loadProvidersFromSchema();

/**
 * Find a provider by key or alias (case-insensitive)
 */
export function findProvider(input: string): ProviderDefinition | undefined {
  const normalizedInput = input.toLowerCase().trim();
  return PROVIDER_DEFINITIONS.find(
    (p) =>
      p.key === normalizedInput ||
      p.apiPrefix === normalizedInput ||
      p.aliases?.some((alias) => alias === normalizedInput)
  );
}

/**
 * Get the environment variable name for a provider's secret
 */
export function envVarName(providerKey: string): string {
  return `SUPABASE_AUTH_EXTERNAL_${providerKey.toUpperCase()}_SECRET`;
}

/**
 * Mask a secret for display (show first 4 and last 4 characters)
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '●'.repeat(secret.length);
  }
  const start = secret.slice(0, 4);
  const end = secret.slice(-4);
  const middle = '●'.repeat(Math.min(secret.length - 8, 16));
  return `${start}${middle}${end}`;
}

/**
 * Build API payload for a single provider
 */
export function buildProviderPayload(
  provider: ProviderDefinition,
  config: ExternalProviderConfig & { enabled?: boolean }
): Record<string, unknown> {
  const prefix = `external_${provider.apiPrefix}`;
  const payload: Record<string, unknown> = {};

  if (config.enabled !== undefined) {
    payload[`${prefix}_enabled`] = config.enabled;
  }

  if (config.client_id !== undefined) {
    payload[`${prefix}_client_id`] = config.client_id;
  }

  if (config.secret !== undefined) {
    payload[`${prefix}_secret`] = config.secret;
  }

  if (config.redirect_uri !== undefined) {
    payload[`${prefix}_redirect_uri`] = config.redirect_uri;
  }

  if (config.url !== undefined && provider.hasUrl) {
    payload[`${prefix}_url`] = config.url;
  }

  if (config.skip_nonce_check !== undefined) {
    payload[`${prefix}_skip_nonce_check`] = config.skip_nonce_check;
  }

  return payload;
}

/**
 * Parse provider config from flat API response
 */
export function parseProviderFromRemote(
  provider: ProviderDefinition,
  remoteConfig: Record<string, unknown>
): (ExternalProviderConfig & { enabled: boolean }) | null {
  const prefix = `external_${provider.apiPrefix}`;
  const enabledKey = `${prefix}_enabled`;
  const clientIdKey = `${prefix}_client_id`;

  // If not enabled and no client_id, provider is not configured
  const enabled = remoteConfig[enabledKey] === true;
  const clientId = remoteConfig[clientIdKey];

  if (!enabled && !clientId) {
    return null;
  }

  const config: ExternalProviderConfig & { enabled: boolean } = {
    enabled,
  };

  if (clientId) {
    config.client_id = String(clientId);
  }

  const secretKey = `${prefix}_secret`;
  if (remoteConfig[secretKey]) {
    config.secret = String(remoteConfig[secretKey]);
  }

  const redirectUriKey = `${prefix}_redirect_uri`;
  if (remoteConfig[redirectUriKey]) {
    config.redirect_uri = String(remoteConfig[redirectUriKey]);
  }

  const urlKey = `${prefix}_url`;
  if (provider.hasUrl && remoteConfig[urlKey]) {
    config.url = String(remoteConfig[urlKey]);
  }

  const skipNonceKey = `${prefix}_skip_nonce_check`;
  if (remoteConfig[skipNonceKey] !== undefined) {
    config.skip_nonce_check = Boolean(remoteConfig[skipNonceKey]);
  }

  return config;
}

/**
 * Get callback URL for a project
 */
export function getCallbackUrl(projectRef: string): string {
  return `https://${projectRef}.supabase.co/auth/v1/callback`;
}
