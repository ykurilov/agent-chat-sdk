/**
 * Подробный вид (договор 37): одинаковые законченные вызовы подряд — одной строкой «… ×N», раскрываются по нажатию.
 * Одинаковые — тот же инструмент и то же название от приложения. В группу попадают только строки, помеченные `call`:
 * вызов с ошибкой, ждущий подтверждения или решённый человеком, с правленым выходом — не помечаются и рвут группу.
 */
export interface GroupableCall {
  toolName: string;
  title?: string;
  /** Ключ раскрытия строки вызова; ключ группы — по первому вызову. */
  partId: string;
}

/** `pending` — часть ещё идёт (вызов без итога, раздумье): серия перед ней, возможно, ещё растёт. */
export type DetailedEntry<Node> = { node: Node; blank?: boolean; pending?: boolean; call?: GroupableCall };

export type DetailedItem<Node> =
  | { kind: "node"; node: Node }
  | { kind: "group"; toolName: string; title?: string; partId: string; partIds: string[]; nodes: Node[] };

const sameCall = (a: GroupableCall, b: GroupableCall) => a.toolName === b.toolName && (a.title ?? "") === (b.title ?? "");

/**
 * Пустой текст (модель только начала писать) группу не рвёт и ставится после неё. Пока ответ идёт (`streaming`), серия,
 * после которой нет ничего, кроме пустого текста и идущих частей, ещё растёт: её строки идут по одной и сворачиваются,
 * когда агент пошёл дальше. Иначе каждый новый вызов то добавлял бы строку, то убирал её — лента скакала бы.
 */
export function detailedItemsOf<Node>(entries: readonly DetailedEntry<Node>[], { streaming }: { streaming: boolean }): DetailedItem<Node>[] {
  const items: DetailedItem<Node>[] = [];
  let index = 0;
  while (index < entries.length) {
    const first = entries[index]!;
    if (!first.call) {
      items.push({ kind: "node", node: first.node });
      index++;
      continue;
    }
    const calls: GroupableCall[] = [];
    const nodes: Node[] = [];
    const blanks: Node[] = [];
    let next = index;
    for (; next < entries.length; next++) {
      const entry = entries[next]!;
      if (entry.call && sameCall(entry.call, first.call)) {
        calls.push(entry.call);
        nodes.push(entry.node);
      } else if (entry.blank && !entry.call) blanks.push(entry.node);
      else break;
    }
    const growing = streaming && entries.slice(next).every((entry) => entry.pending || (entry.blank && !entry.call));
    if (nodes.length > 1 && !growing) {
      items.push({ kind: "group", toolName: first.call.toolName, ...(first.call.title !== undefined && { title: first.call.title }), partId: first.call.partId, partIds: calls.map((call) => call.partId), nodes });
      items.push(...blanks.map((node) => ({ kind: "node" as const, node })));
      index = next;
    } else {
      items.push({ kind: "node", node: first.node });
      index++;
    }
  }
  return items;
}
