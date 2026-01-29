/**
 * Config sync utilities
 * Re-exports from focused modules
 */

// Types
export type {
  ApiConfig,
  AuthConfig,
  ProjectConfig,
  ConfigDiff,
} from "./config-types.js";

// Payload builders (local config -> API)
export {
  buildPostgrestPayload,
  buildAuthPayload,
  getSyncPreview,
} from "./config-payload.js";

// Remote config builders (API -> local config)
export {
  buildApiConfigFromRemote,
  buildAuthConfigFromRemote,
} from "./config-remote.js";

// Diff comparison
export { compareConfigs, formatDiff } from "./config-diff.js";
