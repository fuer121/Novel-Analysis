import type { ContentCipher, EncryptedContent } from "../library/content-encryption.js";

export interface ParseSchema<T> { parse(value: unknown): T }

export function encryptJson(cipher: ContentCipher, value: unknown): EncryptedContent {
  return cipher.encrypt(JSON.stringify(value));
}

export function decryptJson<T>(cipher: ContentCipher, value: EncryptedContent, schema: ParseSchema<T>): T {
  return schema.parse(JSON.parse(cipher.decrypt(value)));
}
