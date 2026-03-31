// AUTO-GENERATED — do not edit manually.
// Run: pnpm generate in packages/config to regenerate.
// Source: packages/config/generate.ts

import type { WorkflowProfile } from "./workflow-profiles.js";
export type { WorkflowProfile } from "./workflow-profiles.js";

export type SchemaManagement = "declarative" | "migrations";
export type ConfigSource = "code" | "remote";

export interface AnalyticsConfig {
  /** Enable the local Logflare service. */
  enabled?: boolean;
  /** Port to the local Logflare service. */
  port?: number;
  /** Port to the local syslog ingest service. */
  vector_port?: number;
  /** Configure one of the supported backends:

- `postgres`
- `bigquery` */
  backend?: "postgres" | "bigquery";
}
export interface ApiConfigTls {
  /** Enable TLS for the local PostgREST service. */
  enabled?: boolean;
}
export interface ApiConfig {
  /** Enable the local PostgREST service. */
  enabled?: boolean;
  /** Port to use for the API URL. */
  port?: number;
  schemas?: Array<string>;
  extra_search_path?: Array<string>;
  /** The maximum number of rows returned from a view, table, or stored procedure. Limits payload size for accidental or malicious requests. */
  max_rows?: number;
  tls?: ApiConfigTls;
  /** External URL for accessing the API server. */
  external_url?: string;
}
export interface AuthConfigHookMfaVerificationAttempt {
  /** Enable/disable the mfa verification hook. */
  enabled?: boolean;
  /** The URI of the postgres function or HTTP endpoint to call. */
  uri?: string;
  /** The secrets to pass to the postgres function or HTTP endpoint. */
  secrets?: Array<string>;
}
export interface AuthConfigHookPasswordVerificationAttempt {
  /** Enable/disable the password verification hook. */
  enabled?: boolean;
  /** The URI of the postgres function or HTTP endpoint to call. */
  uri?: string;
  /** The secrets to pass to the postgres function or HTTP endpoint. */
  secrets?: Array<string>;
}
export interface AuthConfigHookCustomAccessToken {
  /** Enable/disable the custom access token hook. */
  enabled?: boolean;
  /** The URI of the postgres function or HTTP endpoint to call. */
  uri?: string;
  /** The secrets to pass to the postgres function or HTTP endpoint. */
  secrets?: Array<string>;
}
export interface AuthConfigHookSendSms {
  /** Enable/disable the send sms hook. */
  enabled?: boolean;
  /** The URI of the postgres function or HTTP endpoint to call. */
  uri?: string;
  /** The secrets to pass to the postgres function or HTTP endpoint. */
  secrets?: Array<string>;
}
export interface AuthConfigHookSendEmail {
  /** Enable/disable the send email hook. */
  enabled?: boolean;
  /** The URI of the postgres function or HTTP endpoint to call. */
  uri?: string;
  /** The secrets to pass to the postgres function or HTTP endpoint. */
  secrets?: Array<string>;
}
export interface AuthConfigHook {
  mfa_verification_attempt?: AuthConfigHookMfaVerificationAttempt;
  password_verification_attempt?: AuthConfigHookPasswordVerificationAttempt;
  custom_access_token?: AuthConfigHookCustomAccessToken;
  send_sms?: AuthConfigHookSendSms;
  send_email?: AuthConfigHookSendEmail;
}
export interface AuthConfigMfaTotp {
  /** Allow/disallow TOTP enrollment for users. */
  enroll_enabled?: boolean;
  /** Allow/disallow TOTP verification for users. */
  verify_enabled?: boolean;
}
export interface AuthConfigMfaPhone {
  /** Allow/disallow phone enrollment for users. */
  enroll_enabled?: boolean;
  /** Allow/disallow phone verification for users. */
  verify_enabled?: boolean;
  /** The length of the OTP code. */
  otp_length?: number;
  /** The template to use for the phone message. */
  template?: string;
  /** The maximum frequency of the phone messages. */
  max_frequency?: string;
}
export interface AuthConfigMfa {
  totp?: AuthConfigMfaTotp;
  phone?: AuthConfigMfaPhone;
  /** The maximum number of MFA factors a user can enroll in. */
  max_enrolled_factors?: number;
}
export interface AuthConfigSessions {
  /** The timebox for the user session. */
  timebox?: string;
  /** The inactivity timeout for the user session. */
  inactivity_timeout?: string;
}
export interface AuthConfigEmailSmtp {
  /** Hostname or IP address of the SMTP server. */
  host?: string;
  /** Port number of the SMTP server. */
  port?: number;
  /** Username for authenticating with the SMTP server. */
  user?: string;
  /** Password for authenticating with the SMTP server. */
  pass?: string;
  /** Email used as the sender for emails sent from the application. */
  admin_email?: string;
  /** Display name used as the sender for emails sent from the application. */
  sender_name?: string;
}
export interface AuthConfigEmailTemplateInvite {
  /** The subject of the invite email. */
  subject?: string;
  /** The path to the content of the invite email. */
  content_path?: string;
}
export interface AuthConfigEmailTemplateConfirmation {
  /** The subject of the confirmation email. */
  subject?: string;
  /** The path to the content of the confirmation email. */
  content_path?: string;
}
export interface AuthConfigEmailTemplateRecovery {
  /** The subject of the recovery email. */
  subject?: string;
  /** The path to the content of the recovery email. */
  content_path?: string;
}
export interface AuthConfigEmailTemplateMagicLink {
  /** The subject of the magic link email. */
  subject?: string;
  /** The path to the content of the magic link email. */
  content_path?: string;
}
export interface AuthConfigEmailTemplateEmailChange {
  /** The subject of the email change email. */
  subject?: string;
  /** The path to the content of the email change email. */
  content_path?: string;
}
export interface AuthConfigEmailTemplate {
  invite?: AuthConfigEmailTemplateInvite;
  confirmation?: AuthConfigEmailTemplateConfirmation;
  recovery?: AuthConfigEmailTemplateRecovery;
  magic_link?: AuthConfigEmailTemplateMagicLink;
  email_change?: AuthConfigEmailTemplateEmailChange;
}
export interface AuthConfigEmail {
  /** Allow/disallow new user signups via email to your project. */
  enable_signup?: boolean;
  /** If enabled, a user will be required to confirm any email change on both the old, and new email addresses. If disabled, only the new email is required to confirm. */
  double_confirm_changes?: boolean;
  /** If enabled, users need to confirm their email address before signing in. */
  enable_confirmations?: boolean;
  /** If enabled, users will need to reauthenticate or have logged in recently to change their password. */
  secure_password_change?: boolean;
  /** Controls the minimum amount of time that must pass before sending another signup confirmation or password reset email. */
  max_frequency?: string;
  smtp?: AuthConfigEmailSmtp;
  template?: AuthConfigEmailTemplate;
}
export interface AuthConfigSmsTwilio {
  /** Enable/disable Twilio provider for phone login. */
  enabled?: boolean;
  /** The account SID for the Twilio API. */
  account_sid?: string;
  /** The message service SID for the Twilio API. */
  message_service_sid?: string;
  /** The auth token for the Twilio API. */
  auth_token?: string;
}
export interface AuthConfigSmsTwilioVerify {
  /** Enable/disable Twilio Verify provider for phone verification. */
  enabled?: boolean;
  /** The account SID for the Twilio API. */
  account_sid?: string;
  /** The message service SID for the Twilio API. */
  message_service_sid?: string;
  /** The auth token for the Twilio API. */
  auth_token?: string;
}
export interface AuthConfigSmsMessagebird {
  /** Enable/disable MessageBird provider for phone login. */
  enabled?: boolean;
  /** The originator of the SMS message. */
  originator?: string;
  /** The API key for the MessageBird API. */
  api_key?: string;
}
export interface AuthConfigSmsTextlocal {
  /** Enable/disable Textlocal provider for phone login. */
  enabled?: boolean;
  /** The sender of the SMS message. */
  sender?: string;
  /** The API key for the Textlocal API. */
  api_key?: string;
}
export interface AuthConfigSmsVonage {
  /** Enable/disable Vonage provider for phone login. */
  enabled?: boolean;
  /** The sender of the SMS message. */
  from?: string;
  /** The API key for the Vonage API. */
  api_key?: string;
  /** The API secret for the Vonage API. */
  api_secret?: string;
}
export interface AuthConfigSms {
  /** Allow/disallow new user signups via SMS to your project. */
  enable_signup?: boolean;
  /** If enabled, users need to confirm their phone number before signing in. */
  enable_confirmations?: boolean;
  /** The template to use for the SMS message. */
  template?: string;
  /** Controls the minimum amount of time that must pass before sending another sms otp. */
  max_frequency?: string;
  twilio?: AuthConfigSmsTwilio;
  twilio_verify?: AuthConfigSmsTwilioVerify;
  messagebird?: AuthConfigSmsMessagebird;
  textlocal?: AuthConfigSmsTextlocal;
  vonage?: AuthConfigSmsVonage;
  /** Use pre-defined map of phone number to OTP for testing. */
  test_otp?: Record<string, string>;
}
export interface AuthConfigExternalApple {
  /** Use the Apple OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Apple OAuth provider. */
  client_id?: string;
  /** Client secret for the Apple OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Apple OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalAzure {
  /** Use the Azure OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Azure OAuth provider. */
  client_id?: string;
  /** Client secret for the Azure OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Azure OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalBitbucket {
  /** Use the Bitbucket OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Bitbucket OAuth provider. */
  client_id?: string;
  /** Client secret for the Bitbucket OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Bitbucket OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalDiscord {
  /** Use the Discord OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Discord OAuth provider. */
  client_id?: string;
  /** Client secret for the Discord OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Discord OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalFacebook {
  /** Use the Facebook OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Facebook OAuth provider. */
  client_id?: string;
  /** Client secret for the Facebook OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Facebook OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalGithub {
  /** Use the GitHub OAuth provider. */
  enabled?: boolean;
  /** Client ID for the GitHub OAuth provider. */
  client_id?: string;
  /** Client secret for the GitHub OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the GitHub OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalGitlab {
  /** Use the Gitlab OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Gitlab OAuth provider. */
  client_id?: string;
  /** Client secret for the Gitlab OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Gitlab OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalGoogle {
  /** Use the Google OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Google OAuth provider. */
  client_id?: string;
  /** Client secret for the Google OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Google OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalKakao {
  /** Use the Kakao OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Kakao OAuth provider. */
  client_id?: string;
  /** Client secret for the Kakao OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Kakao OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalKeycloak {
  /** Use the Keycloak OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Keycloak OAuth provider. */
  client_id?: string;
  /** Client secret for the Keycloak OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Keycloak OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalLinkedin {
  /** Use the LinkedIn OAuth provider. */
  enabled?: boolean;
  /** Client ID for the LinkedIn OAuth provider. */
  client_id?: string;
  /** Client secret for the LinkedIn OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the LinkedIn OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalNotion {
  /** Use the Notion OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Notion OAuth provider. */
  client_id?: string;
  /** Client secret for the Notion OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Notion OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalTwitch {
  /** Use the Twitch OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Twitch OAuth provider. */
  client_id?: string;
  /** Client secret for the Twitch OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Twitch OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalTwitter {
  /** Use the Twitter OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Twitter OAuth provider. */
  client_id?: string;
  /** Client secret for the Twitter OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Twitter OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalSlack {
  /** Use the Slack OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Slack OAuth provider. */
  client_id?: string;
  /** Client secret for the Slack OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Slack OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalSpotify {
  /** Use the Spotify OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Spotify OAuth provider. */
  client_id?: string;
  /** Client secret for the Spotify OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Spotify OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalWorkos {
  /** Use the WorkOS OAuth provider. */
  enabled?: boolean;
  /** Client ID for the WorkOS OAuth provider. */
  client_id?: string;
  /** Client secret for the WorkOS OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the WorkOS OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternalZoom {
  /** Use the Zoom OAuth provider. */
  enabled?: boolean;
  /** Client ID for the Zoom OAuth provider. */
  client_id?: string;
  /** Client secret for the Zoom OAuth provider.

DO NOT commit your OAuth provider secret to git. Use environment variable substitution instead. */
  secret?: string;
  /** The base URL used for constructing the URLs to request authorization and access tokens. */
  url?: string;
  /** The URI the Zoom OAuth2 provider will redirect to with the code and state values. */
  redirect_uri?: string;
  /** If true, the nonce check will be skipped. */
  skip_nonce_check?: boolean;
}
export interface AuthConfigExternal {
  apple?: AuthConfigExternalApple;
  azure?: AuthConfigExternalAzure;
  bitbucket?: AuthConfigExternalBitbucket;
  discord?: AuthConfigExternalDiscord;
  facebook?: AuthConfigExternalFacebook;
  github?: AuthConfigExternalGithub;
  gitlab?: AuthConfigExternalGitlab;
  google?: AuthConfigExternalGoogle;
  kakao?: AuthConfigExternalKakao;
  keycloak?: AuthConfigExternalKeycloak;
  linkedin?: AuthConfigExternalLinkedin;
  notion?: AuthConfigExternalNotion;
  twitch?: AuthConfigExternalTwitch;
  twitter?: AuthConfigExternalTwitter;
  slack?: AuthConfigExternalSlack;
  spotify?: AuthConfigExternalSpotify;
  workos?: AuthConfigExternalWorkos;
  zoom?: AuthConfigExternalZoom;
}
export interface AuthConfig {
  /** Enable the local GoTrue service. */
  enabled?: boolean;
  /** The base URL of your website. Used as an allow-list for redirects and for constructing URLs used in emails. */
  site_url?: string;
  /** A list of _exact_ URLs that auth providers are permitted to redirect to post authentication. */
  additional_redirect_urls?: Array<string>;
  /** How long tokens are valid for, in seconds. Defaults to 3600 (1 hour), maximum 604,800 seconds (one week). */
  jwt_expiry?: number;
  /** If disabled, the refresh token will never expire. */
  enable_refresh_token_rotation?: boolean;
  /** Allows refresh tokens to be reused after expiry, up to the specified interval in seconds. Requires enable_refresh_token_rotation = true. */
  refresh_token_reuse_interval?: number;
  /** Allow/disallow testing manual linking of accounts. */
  enable_manual_linking?: boolean;
  /** Allow/disallow new user signups to your project. */
  enable_signup?: boolean;
  /** Allow/disallow anonymous sign-ins to your project. */
  enable_anonymous_sign_ins?: boolean;
  hook?: AuthConfigHook;
  mfa?: AuthConfigMfa;
  sessions?: AuthConfigSessions;
  email?: AuthConfigEmail;
  sms?: AuthConfigSms;
  external?: AuthConfigExternal;
}
export interface DbConfigPooler {
  /** Enable the local PgBouncer service. */
  enabled?: boolean;
  /** Port to use for the local connection pooler. */
  port?: number;
  /** Specifies when a server connection can be reused by other clients. Configure one of the supported pooler modes: `transaction`, `session`. */
  pool_mode?: "transaction" | "session";
  /** How many server connections to allow per user/database pair. */
  default_pool_size?: number;
  /** Maximum number of client connections allowed. */
  max_client_conn?: number;
}
export interface DbConfigSeed {
  /** Enable seeding the database with SQL files. */
  enabled?: boolean;
  /** Paths to SQL files to seed the database with. Supports glob patterns relative to supabase directory. */
  sql_paths?: Array<string>;
}
export interface DbConfig {
  /** Port to use for the local database URL. */
  port?: number;
  /** Port to use for the local shadow database. */
  shadow_port?: number;
  /** The database major version to use. This has to be the same as your remote database's. Run `SHOW server_version;` on the remote database to check. */
  major_version?: number;
  pooler?: DbConfigPooler;
  seed?: DbConfigSeed;
}
export interface EdgeRuntimeConfig {
  /** Enable the local Edge Runtime service. */
  enabled?: boolean;
  /** Configure the supported request policy. Use `oneshot` for hot reload, or `per_worker` for load testing. */
  policy?: "oneshot" | "per_worker";
  /** Port to run the Edge Functions inspector on. */
  inspector_port?: number;
}
export interface FunctionsConfigEntry {
  /** Controls whether a function is deployed or served. When set to false,
the function will be skipped during deployment and won't be served locally.
This is useful for disabling demo functions or temporarily disabling a function
without removing its code. */
  enabled?: boolean;
  /** By default, when you deploy your Edge Functions or serve them locally, it
will reject requests without a valid JWT in the Authorization header.
Setting this configuration changes the default behavior. */
  verify_jwt?: boolean;
  /** Specify the Deno import map file to use for the Function.

Note that the `--import-map` flag overrides this configuration. */
  import_map?: string;
  /** Specify the entrypoint path to the Function (defaults to "functions/slug/index.ts").

Both `.js` and `.ts` file extensions are supported. */
  entrypoint?: string;
}
export interface InbucketConfig {
  /** Enable the local InBucket service. */
  enabled?: boolean;
  /** Port to use for the email testing server web interface.

Emails sent with the local dev setup are not actually sent - rather, they are monitored, and you can view the emails that would have been sent from the web interface. */
  port?: number;
  /** Port to use for the email testing server SMTP port.

Emails sent with the local dev setup are not actually sent - rather, they are monitored, and you can view the emails that would have been sent from the web interface.

If set, you can access the SMTP server from this port. */
  smtp_port?: number;
  /** Port to use for the email testing server POP3 port.

Emails sent with the local dev setup are not actually sent - rather, they are monitored, and you can view the emails that would have been sent from the web interface.

If set, you can access the POP3 server from this port. */
  pop3_port?: number;
}
export interface RealtimeConfig {
  /** Enable the local Realtime service. */
  enabled?: boolean;
  /** Bind realtime via either IPv4 or IPv6. */
  ip_version?: "IPv4" | "IPv6";
  /** Maximum length of the HTTP header. */
  max_header_length?: number;
}
export interface StorageConfigImageTransformation {
  /** Enable image transformation. */
  enabled?: boolean;
}
export interface StorageConfigBuckets {
  /** Enable public access to the bucket. */
  public?: boolean;
  /** The maximum file size allowed for the bucket. */
  file_size_limit?: string;
  /** The list of allowed MIME types for the bucket. */
  allowed_mime_types?: Array<string>;
  /** The path to the objects in the bucket. */
  objects_path?: string;
}
export interface StorageConfig {
  /** Enable the local Storage service. */
  enabled?: boolean;
  /** The maximum file size allowed. */
  file_size_limit?: string;
  image_transformation?: StorageConfigImageTransformation;
  /** Storage buckets configuration. */
  buckets?: Record<string, StorageConfigBuckets>;
}
export interface StudioConfig {
  /** Enable the local Supabase Studio dashboard. */
  enabled?: boolean;
  /** Port to use for Supabase Studio. */
  port?: number;
  /** External URL of the API server that frontend connects to. */
  api_url?: string;
  /** OpenAI API key to use for Supabase AI in the Supabase Studio. */
  openai_api_key?: string;
}
export interface ExperimentalConfig {
  /** Postgres storage engine to use OrioleDB (S3) */
  orioledb_version?: string;
  /** S3 bucket URL. */
  s3_host?: string;
  /** S3 bucket region. */
  s3_region?: string;
  /** S3 access key. */
  s3_access_key?: string;
  /** S3 secret key. */
  s3_secret_key?: string;
}
export interface HooksConfigPrePushVariant1 {
  /** Shell command to run. */
  command: string;
  /** Glob pattern of files to watch in dev mode. */
  watch?: string;
}
export interface HooksConfigPrePushVariant2ItemVariant1 {
  /** Shell command to run. */
  command: string;
  /** Glob pattern of files to watch in dev mode. */
  watch?: string;
}
export interface HooksConfigPrePullVariant1 {
  /** Shell command to run. */
  command: string;
  /** Glob pattern of files to watch in dev mode. */
  watch?: string;
}
export interface HooksConfigPrePullVariant2ItemVariant1 {
  /** Shell command to run. */
  command: string;
  /** Glob pattern of files to watch in dev mode. */
  watch?: string;
}
export interface HooksConfig {
  /** Hook(s) to run before push and dev schema operations (e.g., ORM codegen). */
  pre_push?: string | HooksConfigPrePushVariant1 | Array<string | HooksConfigPrePushVariant2ItemVariant1>;
  /** Hook(s) to run before pull operations. */
  pre_pull?: string | HooksConfigPrePullVariant1 | Array<string | HooksConfigPrePullVariant2ItemVariant1>;
}
export interface CodegenConfigTanstack {
  /** Import path for the Supabase client. Defaults to "@/lib/supabase/client". */
  client_path?: string;
  /** Name of the exported client function. Defaults to "createClient". */
  client_function_name?: string;
}
export interface CodegenConfig {
  /** Validation library to generate schemas for. */
  validation?: "zod";
  /** Additional code generation plugins. */
  plugins?: Array<"tanstack">;
  /** Options for the TanStack DB plugin. */
  tanstack?: CodegenConfigTanstack;
}
export interface ProfilesConfig {
  /** The mode for this profile */
  mode?: "local" | "preview" | "remote";
  /** The workflow type for this profile */
  workflow?: "git" | "dashboard";
  /** The schema management approach */
  schema?: "declarative" | "migrations";
  /** Git branch patterns that match this profile */
  branches?: Array<string>;
  /** Override project ID for this profile */
  project?: string;
}

export interface ProjectConfig {
  /** JSON Schema reference for editor support */
  $schema?: string;
  /** A string used to distinguish different Supabase projects on the same host. Defaults to the working directory name when running `supabase init`. */
  project_id?: string;
  analytics?: AnalyticsConfig;
  api?: ApiConfig;
  auth?: AuthConfig;
  db?: DbConfig;
  edge_runtime?: EdgeRuntimeConfig;
  functions?: Record<string, FunctionsConfigEntry>;
  inbucket?: InbucketConfig;
  realtime?: RealtimeConfig;
  storage?: StorageConfig;
  studio?: StudioConfig;
  experimental?: ExperimentalConfig;
  /** The workflow profile to use for this project. */
  workflow_profile?: WorkflowProfile;
  /** The schema management approach for this project. */
  schema_management?: SchemaManagement;
  /** The source of truth for project configuration. */
  config_source?: ConfigSource;
  /** The Git branch to treat as the production branch. */
  production_branch?: string;
  /** Shell commands to run at specific points in the CLI lifecycle. */
  hooks?: HooksConfig;
  /** Code generation settings for type-safe database access. */
  codegen?: CodegenConfig;
  /** Profile configuration for different environments */
  profiles?: Record<string, ProfilesConfig>;
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
