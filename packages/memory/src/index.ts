// Долгая память агента между чатами (спецификация 017).
export { createLongTermMemory, MemoryStorageNotSupportedError } from "./create-long-term-memory";
export type { ConfiguredLongTermMemory, LongTermMemoryOptions } from "./create-long-term-memory";
export type { MemoryCounts } from "./memory-operations";
export { memoryInstructions } from "./instructions";
export { englishMemoryToolTitles, memoryToolTitles, withMemoryToolTitles } from "./tool-titles";
export { defaultMemoryLimits } from "./note-rules";
export type { MemoryLimits } from "./note-rules";
export type { MemoryMergeRecord, MergedGroupView, MergeHistory } from "./optimizer/merge-history";
