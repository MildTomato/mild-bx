/**
 * Config type definitions
 * Matches the config.json schema structure
 */

import type { WorkflowProfile } from "./workflow-profiles.js";
export type { WorkflowProfile } from "./workflow-profiles.js";

export interface ApiConfig {
  enabled?: boolean;
  port?: number;
  schemas?: string[];
  extra_search_path?: string[];
  max_rows?: number;
}

export interface SmtpConfig {
  enabled?: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  admin_email?: string;
  sender_name?: string;
}

export interface EmailConfig {
  enable_signup?: boolean;
  double_confirm_changes?: boolean;
  enable_confirmations?: boolean;
  max_frequency?: string;
  otp_length?: number;
  otp_expiry?: number;
  smtp?: SmtpConfig;
}

export interface ExternalProviderConfig {
  enabled?: boolean;
  client_id?: string;
  secret?: string;
  redirect_uri?: string;
  url?: string;
  skip_nonce_check?: boolean;
}

export interface MfaTotpConfig {
  enroll_enabled?: boolean;
  verify_enabled?: boolean;
}

export interface MfaPhoneConfig {
  enroll_enabled?: boolean;
  verify_enabled?: boolean;
  otp_length?: number;
  template?: string;
  max_frequency?: string;
}

export interface MfaConfig {
  max_enrolled_factors?: number;
  totp?: MfaTotpConfig;
  phone?: MfaPhoneConfig;
}

export interface AuthConfig {
  enabled?: boolean;
  site_url?: string;
  additional_redirect_urls?: string[];
  jwt_expiry?: number;
  enable_refresh_token_rotation?: boolean;
  refresh_token_reuse_interval?: number;
  enable_signup?: boolean;
  enable_anonymous_sign_ins?: boolean;
  enable_manual_linking?: boolean;
  minimum_password_length?: number;
  password_requirements?: string;
  email?: EmailConfig;
  external?: Record<string, ExternalProviderConfig>;
  mfa?: MfaConfig;
}

export type SchemaManagement = "declarative" | "migrations";
export type ConfigSource = "code" | "remote";

export type ValidationLibrary = "zod";
export type PluginName = "tanstack";

export interface TanStackCodegenConfig {
  /** Import path for the Supabase client. Defaults to "@/lib/supabase/client". */
  client_path?: string;
  /** Name of the exported client function. Defaults to "createClient". */
  client_function_name?: string;
}

export interface CodegenConfig {
  validation?: ValidationLibrary;
  plugins?: PluginName[];
  tanstack?: TanStackCodegenConfig;
}

export interface ProjectConfig {
  project_id?: string;
  workflow_profile?: WorkflowProfile;
  schema_management?: SchemaManagement;
  config_source?: ConfigSource;
  api?: ApiConfig;
  auth?: AuthConfig;
  codegen?: CodegenConfig;
  environments?: Record<string, string>;
  // Other sections we don't sync yet
  db?: unknown;
  storage?: unknown;
  realtime?: unknown;
  edge_runtime?: unknown;
  functions?: unknown;
  studio?: unknown;
  analytics?: unknown;
  inbucket?: unknown;
  experimental?: unknown;
}

/**
 * Config diff entry showing old and new values
 */
export interface ConfigDiff {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changed: boolean;
}
