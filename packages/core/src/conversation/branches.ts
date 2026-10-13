import type { StoredBranchSelection } from "./types";

interface BranchNode {
  id: string;
  parentId: string | null;
  createdAt: string;
}

type Selection = Pick<StoredBranchSelection, "messageId" | "selectedAt">;

/** Развилка на текущей ветке: сообщение и все его соседи (общий родитель) по порядку создания, включая его самого. */
export interface BranchFork {
  messageId: string;
  siblingIds: string[];
}

/** Когда сообщение «тронули» в последний раз: создали или выбрали. Побеждает на развилке тот, кого тронули позже. */
export function touchedAt(message: BranchNode, selections: readonly Selection[]): string {
  let touched = message.createdAt;
  for (const selection of selections) {
    if (selection.messageId === message.id && selection.selectedAt > touched) touched = selection.selectedAt;
  }
  return touched;
}

function groupByParent<T extends BranchNode>(messages: readonly T[]): Map<string | null, T[]> {
  const childrenByParent = new Map<string | null, T[]>();
  for (const message of messages) {
    const siblings = childrenByParent.get(message.parentId) ?? [];
    siblings.push(message);
    childrenByParent.set(message.parentId, siblings);
  }
  return childrenByParent;
}

/** Ничья по времени — побеждает записанный позже. */
function winner<T extends BranchNode>(candidates: readonly T[], touched: (message: T) => string): T | undefined {
  return candidates.reduce<T | undefined>(
    (best, candidate) => (best === undefined || touched(candidate) >= touched(best) ? candidate : best),
    undefined,
  );
}

/**
 * Текущая ветка переписки: от первого сообщения, на каждой развилке берётся потомок, которого тронули позже всех
 * (создали или выбрали). Выбор человека — отметка в `selections`, сообщения при этом не меняются.
 */
export function selectCurrentBranch<T extends BranchNode>(messages: readonly T[], selections: readonly Selection[] = []): T[] {
  const childrenByParent = groupByParent(messages);
  const touched = (message: T) => touchedAt(message, selections);
  const branch: T[] = [];
  let current = winner(childrenByParent.get(null) ?? [], touched);
  while (current) {
    branch.push(current);
    current = winner(childrenByParent.get(current.id) ?? [], touched);
  }
  return branch;
}

/** Развилки текущей ветки: соседи по порядку создания, он не зависит от выбора, поэтому номера «2/3» не прыгают. */
export function branchForks<T extends BranchNode>(messages: readonly T[], branch: readonly T[]): BranchFork[] {
  const childrenByParent = groupByParent(messages);
  const forks: BranchFork[] = [];
  for (const message of branch) {
    const siblings = childrenByParent.get(message.parentId) ?? [];
    if (siblings.length < 2) continue;
    const inCreationOrder = siblings
      .map((sibling, order) => ({ sibling, order }))
      .sort((a, b) => (a.sibling.createdAt < b.sibling.createdAt ? -1 : a.sibling.createdAt > b.sibling.createdAt ? 1 : a.order - b.order));
    forks.push({ messageId: message.id, siblingIds: inCreationOrder.map(({ sibling }) => sibling.id) });
  }
  return forks;
}

/**
 * Время для нового соседа на развилке под `parentId` (новый ответ, правка) или для выбора одного из соседей:
 * сейчас, но не раньше миллисекунды после самого позднего касания соседей. Так новое побеждает даже при ничьей
 * и при часах, ушедших назад.
 */
export function nextSiblingTime<T extends BranchNode>(
  messages: readonly T[],
  selections: readonly Selection[],
  parentId: string | null,
  now: number = Date.now(),
): string {
  let latest = -Infinity;
  for (const sibling of groupByParent(messages).get(parentId) ?? []) {
    const touched = Date.parse(touchedAt(sibling, selections));
    if (!Number.isNaN(touched) && touched > latest) latest = touched;
  }
  return new Date(Math.max(now, latest + 1)).toISOString();
}

/** Победитель развилки под `parentId` с учётом выбора; `null`, если под ним никого нет. */
export function currentChildOf<T extends BranchNode>(
  messages: readonly T[],
  selections: readonly Selection[],
  parentId: string | null,
): T | null {
  return winner(groupByParent(messages).get(parentId) ?? [], (message) => touchedAt(message, selections)) ?? null;
}
