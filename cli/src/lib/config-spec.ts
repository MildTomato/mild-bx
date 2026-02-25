/**
 * Config specification for documentation generation
 * Describes each config section and field for docs
 */

export interface ConfigFieldSpec {
  name: string;
  type: string;
  description: string;
  default?: string;
  example?: string;
}

export interface ConfigSectionSpec {
  name: string;
  description: string;
  fields: ConfigFieldSpec[];
  subsections?: ConfigSectionSpec[];
}

export const configSpec: ConfigSectionSpec[] = [
  {
    name: "root",
    description: "Top-level project configuration",
    fields: [
      {
        name: "$schema",
        type: "string",
        description: "JSON Schema URL for editor validation and autocomplete",
        example: '"https://supabase.com/config/v1/schema.json"',
      },
      {
        name: "project_id",
        type: "string",
        description: "Your Supabase project reference ID",
        example: '"abcdefghijklmnop"',
      },
      {
        name: "workflow_profile",
        type: '"remote" | "local" | "branching-remote" | "branching-local"',
        description: "Deployment workflow profile",
        default: '"remote"',
      },
      {
        name: "schema_management",
        type: '"declarative" | "migrations"',
        description: "How schema changes are managed",
        default: '"declarative"',
      },
      {
        name: "config_source",
        type: '"code" | "remote"',
        description: "Source of truth for config settings",
        default: '"code"',
      },
    ],
  },
  {
    name: "api",
    description: "PostgREST Data API configuration",
    fields: [
      {
        name: "enabled",
        type: "boolean",
        description: "Enable the Data API",
        default: "true",
      },
      {
        name: "port",
        type: "number",
        description: "Port for the Data API",
        default: "3000",
      },
      {
        name: "schemas",
        type: "string[]",
        description: "Database schemas exposed through the API",
        default: '["public", "graphql_public"]',
        example: '["public", "api"]',
      },
      {
        name: "extra_search_path",
        type: "string[]",
        description: "Additional schemas in the PostgreSQL search path",
        default: '["public", "extensions"]',
      },
      {
        name: "max_rows",
        type: "number",
        description: "Maximum rows returned per request",
        default: "1000",
      },
    ],
  },
  {
    name: "auth",
    description: "Authentication configuration",
    fields: [
      {
        name: "enabled",
        type: "boolean",
        description: "Enable authentication",
        default: "true",
      },
      {
        name: "site_url",
        type: "string",
        description: "Your app URL for email links and OAuth redirects",
        example: '"https://myapp.com"',
      },
      {
        name: "additional_redirect_urls",
        type: "string[]",
        description: "Allowed OAuth redirect URLs",
        example: '["http://localhost:3000", "https://staging.myapp.com"]',
      },
      {
        name: "jwt_expiry",
        type: "number",
        description: "JWT token lifetime in seconds",
        default: "3600",
      },
      {
        name: "enable_refresh_token_rotation",
        type: "boolean",
        description: "Rotate refresh tokens on use",
        default: "true",
      },
      {
        name: "refresh_token_reuse_interval",
        type: "number",
        description: "Seconds a refresh token can be reused after rotation",
        default: "10",
      },
      {
        name: "enable_signup",
        type: "boolean",
        description: "Allow new user registration",
        default: "true",
      },
      {
        name: "enable_anonymous_sign_ins",
        type: "boolean",
        description: "Allow anonymous authentication",
        default: "false",
      },
      {
        name: "enable_manual_linking",
        type: "boolean",
        description: "Allow manual account linking",
        default: "false",
      },
      {
        name: "minimum_password_length",
        type: "number",
        description: "Minimum password length",
        default: "6",
      },
      {
        name: "password_requirements",
        type: "string",
        description: "Password complexity requirements",
      },
    ],
    subsections: [
      {
        name: "email",
        description: "Email authentication settings",
        fields: [
          {
            name: "enable_signup",
            type: "boolean",
            description: "Allow email sign-up",
            default: "true",
          },
          {
            name: "double_confirm_changes",
            type: "boolean",
            description: "Require confirmation for email changes",
            default: "true",
          },
          {
            name: "enable_confirmations",
            type: "boolean",
            description: "Require email confirmation on sign-up",
            default: "false",
          },
          {
            name: "max_frequency",
            type: "string",
            description: "Rate limit for email sends",
            default: '"1m"',
          },
          {
            name: "otp_length",
            type: "number",
            description: "OTP code length",
            default: "6",
          },
          {
            name: "otp_expiry",
            type: "number",
            description: "OTP expiry in seconds",
            default: "3600",
          },
        ],
        subsections: [
          {
            name: "smtp",
            description: "Custom SMTP server configuration",
            fields: [
              {
                name: "enabled",
                type: "boolean",
                description: "Use custom SMTP server",
                default: "false",
              },
              {
                name: "host",
                type: "string",
                description: "SMTP server hostname",
                example: '"smtp.sendgrid.net"',
              },
              {
                name: "port",
                type: "number",
                description: "SMTP server port",
                default: "587",
              },
              {
                name: "user",
                type: "string",
                description: "SMTP username",
              },
              {
                name: "pass",
                type: "string",
                description: "SMTP password (use environment variables)",
              },
              {
                name: "admin_email",
                type: "string",
                description: "From address for emails",
                example: '"noreply@myapp.com"',
              },
              {
                name: "sender_name",
                type: "string",
                description: "From name for emails",
                example: '"My App"',
              },
            ],
          },
        ],
      },
      {
        name: "external",
        description: "OAuth provider configuration (keyed by provider name)",
        fields: [
          {
            name: "enabled",
            type: "boolean",
            description: "Enable this provider",
          },
          {
            name: "client_id",
            type: "string",
            description: "OAuth client ID",
          },
          {
            name: "secret",
            type: "string",
            description: "OAuth client secret (use environment variables)",
          },
          {
            name: "redirect_uri",
            type: "string",
            description: "Custom OAuth redirect URI",
          },
          {
            name: "url",
            type: "string",
            description: "Custom OAuth endpoint (for OIDC providers)",
          },
          {
            name: "skip_nonce_check",
            type: "boolean",
            description: "Skip nonce validation",
            default: "false",
          },
        ],
      },
      {
        name: "mfa",
        description: "Multi-factor authentication settings",
        fields: [
          {
            name: "max_enrolled_factors",
            type: "number",
            description: "Maximum MFA factors per user",
            default: "10",
          },
        ],
        subsections: [
          {
            name: "totp",
            description: "TOTP (authenticator app) settings",
            fields: [
              {
                name: "enroll_enabled",
                type: "boolean",
                description: "Allow TOTP enrollment",
                default: "true",
              },
              {
                name: "verify_enabled",
                type: "boolean",
                description: "Allow TOTP verification",
                default: "true",
              },
            ],
          },
          {
            name: "phone",
            description: "Phone MFA settings",
            fields: [
              {
                name: "enroll_enabled",
                type: "boolean",
                description: "Allow phone MFA enrollment",
                default: "false",
              },
              {
                name: "verify_enabled",
                type: "boolean",
                description: "Allow phone MFA verification",
                default: "false",
              },
              {
                name: "otp_length",
                type: "number",
                description: "Phone OTP code length",
                default: "6",
              },
              {
                name: "template",
                type: "string",
                description: "SMS template",
              },
              {
                name: "max_frequency",
                type: "string",
                description: "Rate limit for SMS sends",
                default: '"30s"',
              },
            ],
          },
        ],
      },
    ],
  },
];
