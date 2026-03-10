/**
 * Canonical environment variable name mapping - re-exported from @supabase-dx/config
 */
export {
  configPathToEnvVar,
  isEnvVarBinding,
  parseEnvVarBinding,
  getNestedValue,
  validateNoHardcodedSecrets,
  suggestEnvVarName,
} from "@supabase-dx/config";

export { getSensitiveFields } from "@supabase-dx/config";
