/** Точные маршруты Flash1017: max — собственная ступень DeepSeek, не общий xhigh. */
export function isDeepSeekFlash1017(providerModelId: string): boolean {
  return providerModelId === "deepseek/deepseek-v4.1-flash-1017"
    || providerModelId === "accounts/fireworks/models/deepseek-v4p1-flash-1017"
    || providerModelId === "deepseek-ai/DeepSeek-V4.1-Flash-1017";
}
