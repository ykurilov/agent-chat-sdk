import type { ToolExecutionOptions } from "ai";
import type { PageContent, SearchHit } from "../src/services";

/** Все имена «разрешаются» в публичный адрес: сеть в тестах не нужна. */
export const publicHost = async () => ["93.184.216.34"];

export const noImages = { profile: { acceptsImages: false }, providerId: "deepseek" };

export function executeOptions(abortSignal?: AbortSignal): ToolExecutionOptions<unknown> {
  return { toolCallId: "call-1", messages: [], context: undefined, ...(abortSignal && { abortSignal }) } as ToolExecutionOptions<unknown>;
}

export const sampleHits: SearchHit[] = [{ title: "Node.js Releases", url: "https://nodejs.org/releases", snippet: "Текущая версия 26" }];
export const samplePage: PageContent = { url: "https://nodejs.org/releases", title: "Node.js Releases", markdown: "Текущая: 26." };
