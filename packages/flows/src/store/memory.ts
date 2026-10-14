import type { ChatsInState, ClientCardEntry, FlowChatRecord, FlowStore, SavedFlowVersion, SideTaskRecord } from "./flow-store";
import { appliedInTime, byVersionAndState, compareText, mappedState, migratePending, normalizeTime, pendingAdded } from "./flow-store-shared";

interface ChatRow extends FlowChatRecord {
  leaseUntil: string | null;
  leaseOwner: string | null;
}

const copy = <T>(value: T): T => structuredClone(value);

function toRecord(row: ChatRow): FlowChatRecord {
  const { leaseUntil: _leaseUntil, leaseOwner: _leaseOwner, ...record } = row;
  return copy(record);
}

/** Сценарии в памяти процесса: для разработки и тестов. Перезапуск их теряет, две копии сервера их не делят. */
export function memoryFlowStore(): FlowStore {
  const chats = new Map<string, ChatRow>();
  const versions = new Map<string, SavedFlowVersion>();
  /** Человек → поле → запись. */
  const cards = new Map<string, Map<string, ClientCardEntry>>();
  const firstMessages = new Map<string, number>();
  const timeZones = new Map<string, string>();
  /** Человек → [задача, чат] → попытки. */
  const sideTasks = new Map<string, Map<string, SideTaskRecord>>();

  const versionKey = (flowId: string, versionId: string) => JSON.stringify([flowId, versionId]);
  const dayKey = (ownerId: string, day: string) => JSON.stringify([ownerId, day]);
  const isFree = (row: ChatRow, now: string) => row.leaseUntil === null || row.leaseUntil < now;
  const isRunning = (row: ChatRow, now: string) => row.endedAt === null && (row.pausedUntil === null || row.pausedUntil <= now);
  const withChat = (chatId: string, change: (row: ChatRow) => void): FlowChatRecord | null => {
    const row = chats.get(chatId);
    if (!row) return null;
    change(row);
    return toRecord(row);
  };

  return {
    async pinChat(input) {
      const existing = chats.get(input.chatId);
      if (existing) return toRecord(existing);
      const row: ChatRow = {
        chatId: input.chatId,
        ownerId: input.ownerId,
        flowId: input.flowId,
        versionId: input.versionId,
        stateId: input.stateId,
        pending: [],
        dueAt: null,
        dueExitId: null,
        dueBranchHead: null,
        timeZone: input.timeZone,
        updatedAt: normalizeTime(input.at),
        endedAt: null,
        endReason: null,
        pausedUntil: null,
        windowClosed: false,
        dayClosedOn: null,
        delivery: null,
        placement: input.placement ? copy(input.placement) : null,
        leaseUntil: null,
        leaseOwner: null,
      };
      chats.set(input.chatId, row);
      return toRecord(row);
    },
    async getChat(chatId) {
      const row = chats.get(chatId);
      return row ? toRecord(row) : null;
    },
    async updateChat(chatId, patch, at) {
      const row = chats.get(chatId);
      if (!row) return null;
      if (patch.versionId !== undefined) row.versionId = patch.versionId;
      if (patch.stateId !== undefined) row.stateId = patch.stateId;
      if (patch.timeZone !== undefined) row.timeZone = patch.timeZone;
      if (patch.placement !== undefined) row.placement = patch.placement && copy(patch.placement);
      row.updatedAt = normalizeTime(at);
      return toRecord(row);
    },
    async deleteChat(chatId) {
      chats.delete(chatId);
    },

    async addPending(chatId, change) {
      const row = chats.get(chatId);
      const next = row && pendingAdded(row.pending, copy(change));
      if (next) row.pending = next;
    },
    async takePending(chatId) {
      const row = chats.get(chatId);
      if (!row) return [];
      const taken = row.pending;
      row.pending = taken.filter(appliedInTime).map(copy);
      return taken;
    },

    async setDue(chatId, due, options) {
      const row = chats.get(chatId);
      if (!row || (options?.unlessDelivery && row.delivery)) return;
      row.dueAt = due ? normalizeTime(due.at) : null;
      row.dueExitId = due?.exitId ?? null;
      row.dueBranchHead = due?.branchHead ?? null;
      row.leaseUntil = null;
      row.leaseOwner = null;
    },
    async leaseDue({ now, owner, leaseMs, limit }) {
      const moment = normalizeTime(now);
      const leaseUntil = new Date(Date.parse(moment) + leaseMs).toISOString();
      const due = [...chats.values()]
        .filter((row) => row.dueAt !== null && row.dueAt <= moment && isFree(row, moment) && isRunning(row, moment))
        .sort((left, right) => compareText(left.dueAt!, right.dueAt!) || compareText(left.chatId, right.chatId))
        .slice(0, limit);
      for (const row of due) {
        row.leaseUntil = leaseUntil;
        row.leaseOwner = owner;
      }
      return due.map(toRecord);
    },
    async releaseLease(chatId, owner) {
      const row = chats.get(chatId);
      if (!row || row.leaseOwner !== owner) return;
      row.leaseUntil = null;
      row.leaseOwner = null;
    },
    async renewLease({ chatId, owner, now, leaseMs }) {
      const row = chats.get(chatId);
      if (!row || row.leaseOwner !== owner) return false;
      row.leaseUntil = new Date(Date.parse(normalizeTime(now)) + leaseMs).toISOString();
      return true;
    },

    async saveVersion(input) {
      const key = versionKey(input.flowId, input.versionId);
      const existing = versions.get(key);
      if (existing) return existing.hash === input.hash ? "same" : "conflict";
      versions.set(key, { flowId: input.flowId, versionId: input.versionId, hash: input.hash, flow: copy(input.flow), createdAt: normalizeTime(input.at) });
      return "new";
    },
    async getVersion(flowId, versionId) {
      const saved = versions.get(versionKey(flowId, versionId));
      return saved ? copy(saved) : null;
    },

    async countChatsByState({ flowId }) {
      const counts = new Map<string, ChatsInState>();
      for (const row of chats.values()) {
        if (row.flowId !== flowId) continue;
        const key = JSON.stringify([row.versionId, row.stateId]);
        const entry = counts.get(key) ?? { versionId: row.versionId, stateId: row.stateId, chats: 0 };
        entry.chats += 1;
        counts.set(key, entry);
      }
      return [...counts.values()].sort(byVersionAndState);
    },
    async migrateBatch(input) {
      const change = migratePending(input);
      const batch = [...chats.values()]
        .filter((row) => row.flowId === input.flowId && row.versionId !== input.toVersionId)
        .sort((left, right) => compareText(left.chatId, right.chatId))
        .slice(0, input.limit);
      for (const row of batch) {
        row.versionId = input.toVersionId;
        row.stateId = mappedState(row.stateId, input.map);
        if (!row.pending.some((item) => item.key === change.key)) row.pending.push(copy(change));
        row.updatedAt = normalizeTime(input.at);
      }
      return { moved: batch.map((row) => row.chatId) };
    },

    async readCard(ownerId) {
      const card = cards.get(ownerId);
      if (!card) return [];
      return [...card.values()].sort((left, right) => compareText(left.fieldId, right.fieldId)).map(copy);
    },
    async writeCardField(input) {
      const card = cards.get(input.ownerId) ?? new Map<string, ClientCardEntry>();
      card.set(input.fieldId, { fieldId: input.fieldId, value: copy(input.value), updatedAt: normalizeTime(input.at), chatId: input.chatId, flowId: input.flowId });
      cards.set(input.ownerId, card);
    },
    async forgetCard(ownerId, fieldId) {
      if (fieldId === "all") cards.delete(ownerId);
      else cards.get(ownerId)?.delete(fieldId);
    },

    async endChat(chatId, { reason, at }) {
      return withChat(chatId, (row) => {
        if (row.endedAt !== null) return;
        Object.assign(row, { endedAt: normalizeTime(at), endReason: reason, dueAt: null, dueExitId: null, dueBranchHead: null, leaseUntil: null, leaseOwner: null });
      });
    },
    async setPause(chatId, until) {
      return withChat(chatId, (row) => (row.pausedUntil = until === null ? null : normalizeTime(until)));
    },
    async setWindowClosed(chatId, closed) {
      withChat(chatId, (row) => (row.windowClosed = closed));
    },
    async setDayClosed(chatId, day) {
      withChat(chatId, (row) => (row.dayClosedOn = day));
    },
    async setDelivery(chatId, delivery) {
      withChat(chatId, (row) => (row.delivery = delivery === null ? null : copy({ ...delivery, retryAt: normalizeTime(delivery.retryAt) })));
    },

    async readTimeZone(ownerId) {
      return timeZones.get(ownerId) ?? null;
    },
    async writeTimeZone(ownerId, timeZone) {
      timeZones.set(ownerId, timeZone);
    },

    async readSideTasks(ownerId, chatId) {
      const tasks = [...(sideTasks.get(ownerId)?.values() ?? [])].filter((task) => task.chatId === null || task.chatId === chatId);
      return tasks.sort((left, right) => compareText(left.taskId, right.taskId)).map(copy);
    },
    async forgetSideTasks(ownerId) {
      sideTasks.delete(ownerId);
    },
    async noteSideTask(input) {
      const tasks = sideTasks.get(input.ownerId) ?? new Map<string, SideTaskRecord>();
      sideTasks.set(input.ownerId, tasks);
      const key = JSON.stringify([input.taskId, input.chatId]);
      const task = tasks.get(key) ?? { taskId: input.taskId, chatId: input.chatId, asks: 0, doneAt: null };
      if (input.status === "asked") task.asks += 1;
      else task.doneAt ??= normalizeTime(input.at);
      tasks.set(key, task);
      return copy(task);
    },

    async countFirstMessages(ownerId, day) {
      return firstMessages.get(dayKey(ownerId, day)) ?? 0;
    },
    async addFirstMessage(ownerId, day) {
      const key = dayKey(ownerId, day);
      const count = (firstMessages.get(key) ?? 0) + 1;
      firstMessages.set(key, count);
      return count;
    },
  };
}
