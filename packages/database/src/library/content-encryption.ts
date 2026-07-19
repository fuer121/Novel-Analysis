import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedContent { ciphertext: Buffer; nonce: Buffer; tag: Buffer; keyVersion: string }
export interface ContentCipher { encrypt(plaintext: string): EncryptedContent; decrypt(input: EncryptedContent): string }

export function createContentCipher(input: { activeKeyVersion: string; keys: Record<string, Buffer> }): ContentCipher {
  const activeKeyVersion = input.activeKeyVersion;
  const keys = new Map<string, Buffer>();
  for (const [version, key] of Object.entries(input.keys)) {
    if (key.length !== 32) throw new Error("AES-256-GCM keys must be 32 bytes");
    keys.set(version, Buffer.from(key));
  }
  if (!keys.has(activeKeyVersion)) throw new Error("Unknown key version");
  return {
    encrypt(plaintext) {
      const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keys.get(activeKeyVersion)!, nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return { ciphertext, nonce, tag: cipher.getAuthTag(), keyVersion: activeKeyVersion };
    },
    decrypt(encrypted) {
      const key = keys.get(encrypted.keyVersion); if (!key) throw new Error("Unknown key version");
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce); decipher.setAuthTag(encrypted.tag);
      return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
    },
  };
}
