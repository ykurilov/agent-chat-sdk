import { MIN_SECRET_LENGTH } from "../../text/scrub-secrets";
import { resolveModelSilence } from "../../provider-errors/model-silence";
import type { ModelSilenceSetting } from "../../provider-errors/model-silence";
import type { ProviderConnection, ProviderDescription } from "../model-catalog";

/** Имя заголовка HTTP (token из RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Проверенное подключение провайдера: ошибка настройки видна при сборке каталога, а не на первом ходе.
 * Значения заголовков в тексте ошибки не бывает: это секреты.
 */
export function checkedConnection(providerName: string, connection: ProviderConnection): ProviderConnection {
  const { baseURL, headers } = connection;
  if (baseURL !== undefined && !isHttpUrl(baseURL)) {
    throw new Error(`${providerName}: baseURL должен быть адресом http(s)://…, например «https://proxy.example.com/openrouter/api/v1»`);
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name)) throw new Error(`${providerName}: недопустимое имя заголовка «${name}»`);
    if (name.toLowerCase() === "authorization") {
      throw new Error(`${providerName}: заголовок Authorization в подключении не задаётся — он несёт ключ провайдера; токен прокси передайте своим заголовком, например X-Proxy-Token`);
    }
    if (typeof value !== "string" || value === "" || /[\r\n]/.test(value)) {
      throw new Error(`${providerName}: у заголовка «${name}» нет значения или в нём перевод строки (переменная окружения не задана?)`);
    }
    // Значения заголовков — секреты; короче MIN_SECRET_LENGTH они не вычищались бы из журналов.
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`${providerName}: значение заголовка «${name}» короче ${MIN_SECRET_LENGTH} знаков — такой токен не спрятать в журналах; нужен длиннее`);
    }
  }
  return {
    ...(baseURL !== undefined && { baseURL: baseURL.replace(/\/+$/, "") }),
    ...(headers && Object.keys(headers).length > 0 && { headers: { ...headers } }),
  };
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Поле `connection` описания провайдера: только если подключение не прямое. */
export function connectionField(connection: ProviderConnection): { connection?: ProviderConnection } {
  return connection.baseURL !== undefined || connection.headers ? { connection } : {};
}

/** Поле `modelSilenceTimeout` описания провайдера: проверено при сборке каталога, нет — общие сроки агента. */
export function silenceField(providerName: string, connection: ProviderConnection): { modelSilenceTimeout?: ModelSilenceSetting } {
  const setting = connection.modelSilenceTimeout;
  if (setting === undefined) return {};
  resolveModelSilence(setting, undefined, `${providerName}: modelSilenceTimeout`);
  return { modelSilenceTimeout: setting === false ? false : { ...setting } };
}

/** Поле `hiddenFromMenu` описания провайдера: только `true` попадает в описание; не boolean — ошибка настройки. */
export function hiddenField(providerName: string, connection: ProviderConnection): { hiddenFromMenu?: true } {
  const hidden = connection.hiddenFromMenu;
  if (hidden !== undefined && typeof hidden !== "boolean") throw new Error(`${providerName}: hiddenFromMenu — true или false: ${JSON.stringify(hidden)}`);
  return hidden ? { hiddenFromMenu: true } : {};
}

/**
 * Описание провайдера с `connect`, который не копируется: у `{ ...provider, createLanguageModel: своя }` его нет,
 * и подключение через прокси даёт ошибку, а не стандартного провайдера вместо своей модели.
 */
export function connectable(description: ProviderDescription, connect: NonNullable<ProviderDescription["connect"]>): ProviderDescription {
  return Object.defineProperty(description, "connect", { value: connect, enumerable: false });
}
