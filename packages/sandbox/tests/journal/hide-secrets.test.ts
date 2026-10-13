import { describe, expect, it } from "vitest";
import { createSecretHider } from "../../src/journal/hide-secrets";

const KEY = "sk-or-v1-0123456789abcdef";

describe("чистка секретов", () => {
  it("значение ключа из env прячется в любой строке и на любой глубине", () => {
    const hider = createSecretHider({ env: { OPENROUTER_API_KEY: KEY } }).forSettings({});
    const cleaned = hider.value({ a: `ключ ${KEY} тут`, nested: [{ deep: { text: KEY } }], [KEY]: 1 });
    expect(JSON.stringify(cleaned)).not.toContain(KEY);
    expect(JSON.stringify(cleaned)).toContain("[скрыто]");
  });

  it("ключ внутри JSON-строки (в том числе с кавычками) прячется в итоговом тексте", () => {
    const quoted = 'abc"def\\ghi-12345678';
    const hider = createSecretHider({ env: { SECRET: quoted } }).forSettings({});
    const inner = JSON.stringify({ token: quoted });
    const text = JSON.stringify({ output: inner });
    const cleaned = hider.text(JSON.stringify(hider.value({ output: inner })));
    expect(cleaned).not.toContain(JSON.stringify(JSON.stringify(quoted)).slice(1, -1));
    expect(cleaned).not.toContain(JSON.stringify(quoted).slice(1, -1));
    expect(hider.text(text)).not.toContain(quoted);
  });

  it("из env прячутся значения по именам (KEY, TOKEN, SECRET, PASSWORD, PASS, AUTH, CREDENTIAL, PRIVATE), остальные остаются", () => {
    const env = {
      OPENAI_KEY: "sk-test-12345678",
      GITHUB_TOKEN: "ghp_abcdefgh1234",
      APP_SECRET: "secret-value-1",
      DB_PASSWORD: "pw-abcdefgh-1",
      SMTP_PASS: "smtp-pass-1234",
      BASIC_AUTH: "user:authvalue1",
      AWS_CREDENTIALS: "credential-value1",
      PRIVATE_KEY_PEM: "private-pem-12345",
      NODE_ENV: "development-build",
      HOME: "/Users/somebody/home",
      APP_TITLE: "Мой чат с агентом",
    };
    const hider = createSecretHider({ env }).forSettings({});
    for (const [name, value] of Object.entries(env)) {
      const hidden = hider.value(`значение ${value} тут`);
      if (/KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE/.test(name)) expect(hidden, name).not.toContain(value);
      else expect(hidden, name).toContain(value);
    }
  });

  it("пароль внутри адреса (DSN) прячется, сам адрес без пароля остаётся читаемым", () => {
    const hider = createSecretHider({ env: { DATABASE_URL: "postgres://app:s3cr3tpw%21@db.internal:5432/chat", REDIS_URL: "redis://cache.internal:6379" } }).forSettings({});
    const text = hider.value("подключение postgres://app:s3cr3tpw%21@db.internal:5432/chat, пароль s3cr3tpw!, кэш redis://cache.internal:6379");
    expect(text).not.toContain("s3cr3tpw");
    expect(text).toContain("redis://cache.internal:6379");
  });

  it("addSecrets добавляет значения на ходу", () => {
    const hider = createSecretHider({ env: {} });
    hider.addSecrets(["late-added-secret"]);
    expect(hider.forSettings({}).value("a late-added-secret b")).toBe("a [скрыто] b");
  });

  it("чистильщик для тех же настроек общий (кэш по ссылке и по набору секретов)", () => {
    const hider = createSecretHider({ env: {} });
    const settings = { providerOptions: { headers: { Authorization: "Bearer tok-abcdef123456" } } };
    expect(hider.forSettings(settings)).toBe(hider.forSettings(settings));
    expect(hider.forSettings({ ...settings })).toBe(hider.forSettings(settings));
  });

  it("значения короче 8 знаков из env не трогаются", () => {
    const hider = createSecretHider({ env: { MODE: "dev", PORT: "3000", EMPTY: undefined, SECRET_SHORT: "1234567" } }).forSettings({});
    expect(hider.value("dev 3000 1234567")).toBe("dev 3000 1234567");
  });

  it("Authorization-подобные поля providerOptions прячутся и по имени, и по значению во всех кусках", () => {
    const settings = {
      temperature: 0.1,
      providerOptions: { openrouter: { headers: { Authorization: "Bearer tok-abcdef123456" }, apiKey: "plain-key-987654", user: "admin" } },
    };
    const hider = createSecretHider({ env: {} }).forSettings(settings);
    const hiddenSettings = JSON.stringify(hider.settings(settings));
    expect(hiddenSettings).not.toContain("tok-abcdef123456");
    expect(hiddenSettings).not.toContain("plain-key-987654");
    expect(hiddenSettings).toContain("admin");
    expect(hiddenSettings).toContain("temperature");
    // То же значение в другом куске того же события: в тексте инструмента.
    const elsewhere = JSON.stringify(hider.value({ echo: "заголовок: Bearer tok-abcdef123456, ключ plain-key-987654" }));
    expect(elsewhere).not.toContain("tok-abcdef123456");
    expect(elsewhere).not.toContain("plain-key-987654");
  });

  it("ключ в base64 (как Basic-заголовок) тоже прячется", () => {
    const hider = createSecretHider({ env: { API_KEY: KEY } }).forSettings({});
    const encoded = Buffer.from(`user:${KEY}`).toString("base64");
    const direct = Buffer.from(KEY).toString("base64");
    expect(JSON.stringify(hider.value({ basic: encoded, direct }))).not.toContain(direct);
    expect(JSON.stringify(hider.value({ basic: encoded }))).not.toContain(encoded);
  });

  it("явно заданные секреты прячутся так же, как значения из env", () => {
    const hider = createSecretHider({ env: {}, secrets: ["super-secret-value"] }).forSettings({});
    expect(hider.value("a super-secret-value b")).toBe("a [скрыто] b");
  });

  it("без секретов значение возвращается как есть", () => {
    const hider = createSecretHider({ env: {} }).forSettings({ temperature: 1 });
    expect(hider.value({ a: [1, "два", null] })).toEqual({ a: [1, "два", null] });
  });
});
