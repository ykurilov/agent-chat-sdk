/*
 * Portions adapted from pi-mono (https://github.com/badlogic/pi-mono), Copyright (c) 2025 Mario Zechner, MIT License.
 * Списки признаков — из packages/ai/src/utils/overflow.ts и retry.ts. Полный текст лицензии — THIRD_PARTY_NOTICES.md.
 */

const signs = (patterns: readonly string[]): RegExp => new RegExp(patterns.join("|"), "i");

/** Тексты ответов провайдеров, когда запрос не влез в окно модели. */
const OVERFLOW_SIGNS: readonly RegExp[] = [
  /prompt (?:is )?too long/i, // Anthropic, z.ai
  /prompt exceeds max length/i, // z.ai
  /request_too_large/i, // Anthropic: размер запроса
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // прокси, совместимые с OpenAI
  /input token count.*exceeds the maximum/i, // Google
  /maximum prompt length is \d+/i, // xAI
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter, Poolside
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi
  /too large for model with \d+ maximum context length/i, // Mistral
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, // DS4
  /model_context_window_exceeded/i, // z.ai
  /prompt too long; exceeded (?:max )?context length/i, // Ollama
  /range of input length should be/i, // DashScope, Qwen
  /context[_ ]length[_ ]exceeded/i, // общий запас
  /too many tokens/i, // общий запас
  /token limit exceeded/i, // общий запас
];

/** Признаки лимита запросов и сбоя сервера: такая ошибка — не переполнение, даже если совпала с признаком выше. */
const NOT_OVERFLOW_SIGNS: readonly RegExp[] = [
  /^(Throttling error|Service unavailable):/i, // AWS Bedrock
  /rate limit/i,
  /too many requests/i,
  /throttl/i, // дополнение SDK: «ThrottlingException: Too many tokens, please wait…» без префикса из Pi
  /please wait/i, // дополнение SDK: «Too many tokens, please wait before trying again»
];

/** Исчерпана квота, бюджет или оплата: повтор через секунды не поможет. */
const NOT_RETRYABLE_SIGNS = signs([
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
  "available balance",
  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",
  "subscription_sharing_usage_limit_exceeded",
]);

/** Временные сбои: нагрузка, сеть, оборванный поток. Голых «500», «502» нет: в тексте 4xx-ответа они ложно срабатывают. */
const RETRYABLE_SIGNS = signs([
  "overloaded",
  "currently experiencing high demand",
  "rate.?limit",
  "too many requests",
  "service.?unavailable",
  "server.?error",
  "internal.?error",
  "provider.?returned.?error",
  "exceeded request buffer limit while retrying upstream",
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",
  "websocket.?closed",
  "websocket.?error",
  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
  "retry delay",
  "you can retry your request",
  "try your request again",
  "please retry your request",
  "ResourceExhausted",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_user_unavailable",
]);

/** Запрос не влез в окно модели: признаки в тексте или код 413. Признаки лимита запросов — не переполнение. */
export function isContextOverflow(text: string, statusCode?: number): boolean {
  if (statusCode === 413) return true;
  if (NOT_OVERFLOW_SIGNS.some((sign) => sign.test(text))) return false;
  return OVERFLOW_SIGNS.some((sign) => sign.test(text));
}

/** Квота, бюджет или оплата исчерпаны: повторять не нужно. */
export function isNotRetryable(text: string): boolean {
  return NOT_RETRYABLE_SIGNS.test(text);
}

/** Текст похож на временный сбой провайдера или сети. */
export function looksTransient(text: string): boolean {
  return RETRYABLE_SIGNS.test(text);
}
