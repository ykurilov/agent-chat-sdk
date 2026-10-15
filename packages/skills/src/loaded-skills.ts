import { createHash } from "node:crypto";
import { activeCompaction, loadCurrentBranch } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { USE_SKILL_TOOL } from "./skill-texts";

export type BranchStorage = Pick<ChatStorage, "listMessages" | "listCompactions" | "listBranchSelections">;

/**
 * Начало результата `use_skill` с телом: по нему видно, какой навык и какой версии уже перед глазами модели.
 * Отпечаток тела отличает навык, созданный заново с тем же именем: его версия снова 1, а текст другой.
 */
export function skillHeader(skill: { name: string; version: number; body: string }): string {
  const hash = createHash("sha256").update(skill.body).digest("hex").slice(0, 12);
  return `<skill name="${skill.name}" version="${skill.version}" hash="${hash}">`;
}

/**
 * Тело навыка с этим заголовком (`skillHeader`) уже видно модели: оно в результате `use_skill` на текущей ветке после сжатой части.
 * Другая ветка («Переделать», правка вопроса) и сжатая часть не в счёт — там тело модели не видно.
 */
export async function isSkillVisibleInHistory(storage: BranchStorage, chatId: string, header: string): Promise<boolean> {
  const branch = await loadCurrentBranch(storage, chatId);
  const active = activeCompaction(branch, await storage.listCompactions(chatId));
  return branch.slice(active ? active.throughIndex + 1 : 0).some((message) =>
    message.parts.some((part) => {
      if (part.type !== `tool-${USE_SKILL_TOOL}`) return false;
      const call = part as { state?: string; output?: unknown };
      return call.state === "output-available" && typeof call.output === "string" && call.output.startsWith(header);
    }),
  );
}
