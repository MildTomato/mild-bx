/**
 * Shared TypeScript types for environment variable management
 */

export interface EnvVariable {
  key: string;
  value: string;
  secret: boolean;
}

export interface Environment {
  name: string;
  is_default: boolean;
  created_at?: string;
  variable_count?: number;
}

export interface EnvDiffEntry {
  key: string;
  type: 'added' | 'changed' | 'removed';
  localValue?: string;
  remoteValue?: string;
  secret: boolean;
}

export interface ParsedEnvFile {
  variables: EnvVariable[];
  header?: string; // comment header (e.g. "Pulled from preview")
}
