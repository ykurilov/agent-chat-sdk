import { describe, expect, it } from "vitest";
import { environmentSecrets, scrubSecrets } from "../../../src/text/scrub-secrets";
import { mockCatalog } from "../support/mock-model";

const catalog = mockCatalog({});
const providerKey = "fw_настоящий-ключ-провайдера-1234";
const env = { FIREWORKS_API_KEY: providerKey, MOCK_API_KEY: "коротко", UNRELATED: "значение-не-ключа-провайдера" };

describe("scrubSecrets", () => {
  it("известные секреты не короче 8 знаков → [скрыто], везде, где встречаются", () => {
    expect(scrubSecrets(`ключ ${providerKey} в тексте`, [providerKey])).toBe("ключ [скрыто] в тексте");
    expect(scrubSecrets(`${providerKey}/${providerKey}`, [providerKey])).toBe("[скрыто]/[скрыто]");
  });

  it("короткие известные значения не трогаются: они совпали бы с обычными словами", () => {
    expect(scrubSecrets("коротко", ["коротко", undefined])).toBe("коротко");
  });

  it("шаблоны ключей: Bearer, sk-, key=", () => {
    expect(scrubSecrets("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [скрыто]");
    expect(scrubSecrets("ключ sk-proj_ABCdef12345678 неверен")).toBe("ключ [скрыто] неверен");
    expect(scrubSecrets('https://x.test/v1?key=AIzaSy123&alt=sse "')).toBe('https://x.test/v1?key=[скрыто]&alt=sse "');
  });

  it("пароль в адресе: логин виден, пароль скрыт", () => {
    expect(scrubSecrets("connect failed: postgres://app:S3cretPass@10.0.0.5:5432/shop")).toBe(
      "connect failed: postgres://app:[скрыто]@10.0.0.5:5432/shop",
    );
    expect(scrubSecrets("redis://:p%40ss@cache:6379 и https://user:pw@host.test/x")).toBe(
      "redis://:[скрыто]@cache:6379 и https://user:[скрыто]@host.test/x",
    );
  });

  it("пароли и токены в параметрах и JSON", () => {
    expect(scrubSecrets("login?user=anna&password=hunter2&next=/")).toBe("login?user=anna&password=[скрыто]&next=/");
    expect(scrubSecrets("cb?access_token=ya29.a0Af&state=1")).toBe("cb?access_token=[скрыто]&state=1");
    expect(scrubSecrets('{"user":"anna","password":"hunter2","clientSecret": "abc"}')).toBe(
      '{"user":"anna","password":"[скрыто]","clientSecret": "[скрыто]"}',
    );
  });

  it("узнаваемые ключи сервисов: GitHub, Slack, AWS, Google, JWT", () => {
    for (const secret of [
      "ghp_1234567890abcdefghijABCDEFGHIJ123456",
      "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
      "xoxb-123456789012-abcdefABCDEF",
      "AKIAIOSFODNN7EXAMPLE",
      "AIzaSyA-1234567890abcdefghijklmnopqrs",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "sk_live_51Habcdefghijk",
    ]) {
      expect(scrubSecrets(`ошибка: ${secret} не принят`)).toBe("ошибка: [скрыто] не принят");
    }
  });

  it("пароль в адресе с @ и / внутри скрыт целиком; адрес после хоста виден", () => {
    expect(scrubSecrets("connect postgres://u:p@ss@db.local:5432/shop")).toBe("connect postgres://u:[скрыто]@db.local:5432/shop");
    expect(scrubSecrets("connect postgres://u:pa/ss@db.local/shop")).toBe("connect postgres://u:[скрыто]@db.local/shop");
    expect(scrubSecrets("https://u:pw@host.test/path?email=anna@mail.test")).toBe("https://u:[скрыто]@host.test/path?email=anna@mail.test");
  });

  it("поля с паролем: в кавычках, через двоеточие, заголовки авторизации и ключа", () => {
    expect(scrubSecrets('config: password="my pass" user=anna')).toBe('config: password="[скрыто]" user=anna');
    expect(scrubSecrets("password: hunter2\nhost: db")).toBe("password: [скрыто]\nhost: db");
    expect(scrubSecrets("Authorization: Basic dXNlcjpwYXNz")).toBe("Authorization: Basic [скрыто]");
    expect(scrubSecrets("Authorization: Token abc123def")).toBe("Authorization: Token [скрыто]");
    expect(scrubSecrets("X-Api-Key: abcdef123456")).toBe("X-Api-Key: [скрыто]");
  });

  it("ключи Hugging Face, Groq, npm, SendGrid и закрытый ключ PEM", () => {
    for (const secret of [
      "hf_abcdefghijklmnopqrstuvwxyz123456",
      "gsk_abcdefghijklmnopqrstuvwxyz123456",
      "npm_abcdefghijklmnopqrstuvwxyz1234567890",
      "SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    ]) {
      expect(scrubSecrets(`ошибка: ${secret} не принят`)).toBe("ошибка: [скрыто] не принят");
    }
  });

  it("обычный текст ошибок не портится: счётчики токенов, числа, слова с key", () => {
    for (const text of [
      "invalid max_tokens=0",
      "token_count=5, max_output_tokens: 4096",
      "primary key=id violates constraint",
      "turkey=5",
      "token=5",
      "Unexpected token '}' in JSON at position 12",
      "Сервис недоступен: таймаут 30 с при запросе https://api.example.com:8443/v1/items?id=5",
    ]) {
      expect(scrubSecrets(text)).toBe(text);
    }
  });

  it("key= без разделителя перед ним, bearer в любом регистре, слово ключа через пробел", () => {
    expect(scrubSecrets("fetch failed key=abcd1234")).toBe("fetch failed key=[скрыто]");
    expect(scrubSecrets("KEY: abcd1234efgh")).toBe("KEY: [скрыто]");
    expect(scrubSecrets("header bearer abc123def456")).toBe("header bearer [скрыто]");
    expect(scrubSecrets("BEARER abc123def456")).toBe("BEARER [скрыто]");
    expect(scrubSecrets("invalid token abc123def456 given")).toBe("invalid token [скрыто] given");
    expect(scrubSecrets("bad api-key abcdef123456")).toBe("bad api-key [скрыто]");
    expect(scrubSecrets("wrong Password Xy7#pq2Lmn!")).toBe("wrong Password [скрыто]");
  });

  it("маски ключей со звёздочками целиком: последние знаки ключа не уходят", () => {
    expect(scrubSecrets("Incorrect API key provided: sk-proj-********************abcd. You can find")).toBe(
      "Incorrect API key provided: [скрыто]. You can find",
    );
    expect(scrubSecrets("key sk-ab****wxyz")).not.toContain("wxyz");
  });

  it("слово ключа через пробел не трогает обычные слова и числа", () => {
    for (const text of ["token limit exceeded", "token 4096 too long", "invalid token in request", "password is wrong", "api-key missing", "key expired"]) {
      expect(scrubSecrets(text)).toBe(text);
    }
  });

  it("обычный текст без секретов не меняется", () => {
    const text = "Сервис недоступен: таймаут 30 с при запросе https://api.example.com/v1/items?id=5";
    expect(scrubSecrets(text)).toBe(text);
  });
});

describe("environmentSecrets", () => {
  it("ключи провайдеров каталога и переменные с секретом в имени; прочие переменные — нет", () => {
    const secrets = environmentSecrets({ ...env, FIRECRAWL_API_KEY: "fc-ключ-поиска", DB_PASSWORD: "пароль-базы", BOT_TOKEN: "токен-бота", HOME: "/home/app" }, catalog);
    expect(secrets).toEqual(expect.arrayContaining([providerKey, "коротко", "fc-ключ-поиска", "пароль-базы", "токен-бота"]));
    expect(secrets).not.toContain("значение-не-ключа-провайдера");
    expect(secrets).not.toContain("/home/app");
  });

  it("переменные с секретом в имени, но значением не похожим на секрет — путь, адрес без пароля, слово — не скрываются", () => {
    const secrets = environmentSecrets(
      { KEY_PATH: "/etc/ssl/key.pem", TOKEN_URL: "https://auth.example.com/token", SECRET_MODE: "production", DB_PASSWORD: "Pr0d-Pa55word", DATABASE_SECRET_URL: "postgres://u:pw@db/x" },
      catalog,
    );
    expect(secrets).toEqual(["Pr0d-Pa55word", "postgres://u:pw@db/x"]);
  });

  it("ключ провайдера скрывается, даже если похож на слово", () => {
    expect(environmentSecrets({ FIREWORKS_API_KEY: "productionkey" }, catalog)).toEqual(["productionkey"]);
  });
});
