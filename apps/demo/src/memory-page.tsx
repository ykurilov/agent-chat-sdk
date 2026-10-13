import { AgentMemory, createMemoryApi } from "@ykurilov/agent-chat-react";
import { tandemMemorySkin } from "@ykurilov/agent-chat-skin-tandem";
import { useMemo } from "react";

/** Экран памяти агента: записи о человеке, которые агент хранит между чатами. */
export function MemoryPage({ api }: { api: string }) {
  // Один раз на человека: при смене объекта экран загружает список заново.
  const memoryApi = useMemo(() => createMemoryApi({ api }), [api]);
  return (
    <div className="h-full overflow-y-auto">
      <AgentMemory api={memoryApi} skin={tandemMemorySkin} />
    </div>
  );
}
