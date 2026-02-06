/**
 * ECDH encryption for secure token exchange
 * Matches supabase-cli login encryption
 */

import { createECDH, createDecipheriv } from "node:crypto";

/**
 * Generate ECDH P-256 key pair
 */
export async function generateKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();

  return {
    publicKey: ecdh.getPublicKey(),
    privateKey: ecdh.getPrivateKey(),
  };
}

/**
 * Decrypt access token using ECDH shared secret
 */
export async function decryptToken(
  encryptedToken: string,
  remotePublicKeyHex: string,
  nonceHex: string,
  privateKey: Uint8Array,
): Promise<string> {
  const encryptedData = Buffer.from(encryptedToken, "hex");
  const nonce = Buffer.from(nonceHex, "hex");
  const remotePublicKey = Buffer.from(remotePublicKeyHex, "hex");

  // Compute shared secret using ECDH
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  const sharedSecret = ecdh.computeSecret(remotePublicKey);

  // AES-GCM decryption
  // The auth tag is the last 16 bytes of the encrypted data
  const authTagLength = 16;
  const ciphertext = encryptedData.subarray(0, encryptedData.length - authTagLength);
  const authTag = encryptedData.subarray(encryptedData.length - authTagLength);

  const decipher = createDecipheriv("aes-256-gcm", sharedSecret, nonce);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf-8");
}
