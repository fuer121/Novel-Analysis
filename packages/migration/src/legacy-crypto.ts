import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { LegacyChapter } from "./contracts.js";

const normalizedPlaintext = (plaintext: string): string =>
  plaintext.normalize("NFC").replace(/\r\n?/g, "\n");

export const plaintextDigest = (plaintext: string): string =>
  createHash("sha256").update(normalizedPlaintext(plaintext), "utf8").digest("hex");

export function decryptLegacyChapter(
  chapter: LegacyChapter,
  oldMasterKey: Buffer,
): Readonly<{ plaintext: string; digest: string }> {
  let plaintext: string;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      oldMasterKey,
      Buffer.from(chapter.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(`chapter:${chapter.bookSourceId}:${chapter.chapterIndex}`),
    );
    decipher.setAuthTag(Buffer.from(chapter.tag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(chapter.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("source_decrypt_failed");
  }

  const expected = createHmac("sha256", oldMasterKey)
    .update(plaintext, "utf8")
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(chapter.contentHmac, "hex");
  } catch {
    throw new Error("source_hmac_mismatch");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("source_hmac_mismatch");
  }

  return Object.freeze({ plaintext, digest: plaintextDigest(plaintext) });
}
