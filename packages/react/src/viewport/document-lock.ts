/** Full-screen shells own document scrolling, embedded chats do not. Leases compose across mounts. */
const locks = new WeakMap<Document, { count: number; restore: () => void }>();
export function lockDocument(document: Document): () => void {
  let lock = locks.get(document);
  if (!lock) {
    const win = document.defaultView!;
    const x = win.scrollX, y = win.scrollY;
    const saved: Array<() => void> = [];
    for (const [element, values] of [
      [document.documentElement, { overflow: "hidden", "overscroll-behavior": "none" }],
      [document.body, {
        "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px",
        "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
        "overscroll-behavior": "none",
      }],
    ] as const) {
      for (const [name, value] of Object.entries(values)) {
        const old = element.style.getPropertyValue(name), priority = element.style.getPropertyPriority(name);
        element.style.setProperty(name, value);
        saved.push(() => { if (old) element.style.setProperty(name, old, priority); else element.style.removeProperty(name); });
      }
    }
    lock = { count: 0, restore: () => { saved.reverse().forEach(restore => restore()); win.scrollTo(x, y); } };
    locks.set(document, lock);
  }
  lock.count++;
  let released = false;
  return () => {
    if (released) return; released = true;
    if (--lock!.count === 0) { lock!.restore(); locks.delete(document); }
  };
}
