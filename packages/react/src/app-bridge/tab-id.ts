/** Под этим ключом `sessionStorage` хранит номер вкладки: переживает перезагрузку, у новой вкладки свой. */
export const TAB_ID_KEY = "agent-chat:tab-id";

/**
 * Под ключом `agent-chat:tab-open:{номер}` `localStorage` отмечает, что страница с этим номером открыта; уходя (`pagehide`),
 * страница снимает отметку. «Дублировать вкладку» копирует `sessionStorage` вместе с номером, но исходная вкладка ещё открыта —
 * дубликат видит отметку и берёт себе новый номер. Иначе обе вкладки исполнили бы один браузерный вызов.
 */
export const tabOpenKey = (tabId: string) => `agent-chat:tab-open:${tabId}`;

/** Номер, который заняла эта страница; на время жизни страницы. */
let pageTabId: string | null = null;
let listening = false;

/** Номер этой вкладки: прочитанный из `sessionStorage`, если другая открытая вкладка его не занимает, иначе новый случайный. */
export function readTabId(): string {
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored !== null && stored !== "" && (stored === pageTabId || !openElsewhere(stored))) return claim(stored);
    const created = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, created);
    return claim(created);
  } catch {
    // Приватный режим: номер один на страницу, после перезагрузки — новый.
    pageTabId ??= crypto.randomUUID();
    return pageTabId;
  }
}

function openElsewhere(tabId: string): boolean {
  try {
    return localStorage.getItem(tabOpenKey(tabId)) !== null;
  } catch {
    return false;
  }
}

function claim(tabId: string): string {
  if (pageTabId !== tabId) {
    markOpen(false);
    pageTabId = tabId;
    markOpen(true);
    if (!listening && typeof addEventListener === "function") {
      listening = true;
      addEventListener("pagehide", () => markOpen(false));
      addEventListener("pageshow", () => markOpen(true));
    }
  }
  return tabId;
}

function markOpen(open: boolean) {
  if (pageTabId === null) return;
  try {
    if (open) localStorage.setItem(tabOpenKey(pageTabId), "1");
    else localStorage.removeItem(tabOpenKey(pageTabId));
  } catch {
    // Хранилище недоступно: дубликат не отличить, номер останется общим.
  }
}
