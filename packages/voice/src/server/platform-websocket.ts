/** Встроенный WebSocket есть в Node.js с версии 22; на Node 20 соединение с Soniox и ElevenLabs иначе упало бы только при первом разговоре. */
export function assertPlatformWebSocket(feature: string): void {
  if (typeof globalThis.WebSocket === "function") return;
  throw new Error(`${feature} нужен встроенный WebSocket, а он есть только в Node.js 22 и новее (сейчас ${process.version}). Обновите Node.js до 22 или выше.`);
}
