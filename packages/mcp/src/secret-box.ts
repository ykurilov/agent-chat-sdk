import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Ключ приложения короче — слишком легко подобрать. */
export const MIN_SECRET_KEY_LENGTH = 32;
const VERSION = "v1";
const IV_BYTES = 12;

/** Шифрует адреса и заголовки серверов ключом приложения. */
export interface SecretBox {
  seal(text: string): string;
  open(sealed: string): string;
}

/**
 * AES-256-GCM; ключ шифрования выводится из `secretKey` приложения (HKDF-SHA256), поэтому сам ключ приложения в
 * шифр не попадает. Запись: `v1.<iv>.<метка>.<шифр>` в base64url. Подделку или чужой ключ GCM замечает.
 */
export function createSecretBox(secretKey: string): SecretBox {
  if (typeof secretKey !== "string" || secretKey.length < MIN_SECRET_KEY_LENGTH) {
    throw new Error(
      `MCP: secretKey — ключ шифрования адресов и заголовков серверов, не короче ${MIN_SECRET_KEY_LENGTH} знаков ` +
        "(например, `openssl rand -base64 48` в переменную окружения). Сменить ключ — значит заново ввести заголовки серверов.",
    );
  }
  const key = Buffer.from(hkdfSync("sha256", secretKey, "agent-chat-mcp", "server secrets v1", 32));
  return {
    seal(text) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    },
    open(sealed) {
      const [version, iv, tag, encrypted] = sealed.split(".");
      try {
        if (version !== VERSION || !iv || !tag || encrypted === undefined) throw new Error("bad format");
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw new Error("MCP: секрет сервера не расшифровать — сменился secretKey приложения? Введите адрес и заголовки сервера заново.");
      }
    },
  };
}
