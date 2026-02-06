/**
 * Credentials store using OS keyring
 * Matches supabase-cli behavior: keyring → file fallback
 */

import keytar from "keytar";

const NAMESPACE = "Supabase CLI";

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/**
 * Check if running on WSL (keyring not supported)
 */
async function isWSL(): Promise<boolean> {
  try {
    const { readFile } = await import("node:fs/promises");
    const osRelease = await readFile("/proc/sys/kernel/osrelease", "utf-8");
    return osRelease.includes("WSL") || osRelease.includes("Microsoft");
  } catch {
    return false;
  }
}

let keyringSupported: boolean | null = null;

/**
 * Check if keyring is supported on this platform
 */
async function isKeyringSupported(): Promise<boolean> {
  if (keyringSupported !== null) {
    return keyringSupported;
  }

  // WSL doesn't support keyring
  if (await isWSL()) {
    keyringSupported = false;
    return false;
  }

  // Assume supported on other platforms
  keyringSupported = true;
  return true;
}

/**
 * Keyring-based credential store
 */
class KeyringStore implements CredentialStore {
  async get(key: string): Promise<string | null> {
    if (!(await isKeyringSupported())) {
      return null;
    }
    try {
      return await keytar.getPassword(NAMESPACE, key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!(await isKeyringSupported())) {
      throw new Error("Keyring is not supported on this platform");
    }
    await keytar.setPassword(NAMESPACE, key, value);
  }

  async delete(key: string): Promise<boolean> {
    if (!(await isKeyringSupported())) {
      return false;
    }
    try {
      return await keytar.deletePassword(NAMESPACE, key);
    } catch {
      return false;
    }
  }
}

export const credentialStore = new KeyringStore();
export { isKeyringSupported };
