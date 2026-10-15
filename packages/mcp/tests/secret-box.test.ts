import { describe, expect, it } from "vitest";
import { createSecretBox } from "../src/secret-box";

const key = "ключ-приложения-длиной-больше-32-знаков-0123456789";

describe("шифрование секретов серверов", () => {
  it("зашифрованное открывается тем же ключом; текст секрета в записи не виден", () => {
    const box = createSecretBox(key);
    const sealed = box.seal("Bearer sk-live-очень-секретный-токен");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("sk-live");
    expect(box.open(sealed)).toBe("Bearer sk-live-очень-секретный-токен");
  });

  it("одно и то же значение каждый раз шифруется по-разному", () => {
    const box = createSecretBox(key);
    expect(box.seal("одно")).not.toBe(box.seal("одно"));
  });

  it("чужой ключ или подделанная запись — ошибка без текста секрета", () => {
    const sealed = createSecretBox(key).seal("секрет-123456789");
    const other = createSecretBox(`${key}-другой`);
    expect(() => other.open(sealed)).toThrow(/не расшифровать/);
    const broken = `${sealed.slice(0, -2)}AA`;
    expect(() => createSecretBox(key).open(broken)).toThrow(/не расшифровать/);
  });

  it("короткий или пустой ключ — ошибка настройки", () => {
    expect(() => createSecretBox("короткий")).toThrow(/secretKey/);
    expect(() => createSecretBox("")).toThrow(/secretKey/);
  });
});
