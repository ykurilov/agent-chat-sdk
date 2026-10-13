// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { partKey, useExpandedParts, usePartOpen } from "../src/expanded-parts";
import type { ExpandedParts } from "../src/expanded-parts";

afterEach(cleanup);

/** Часть ответа, которая считает свои перерисовки. */
function CountingPart({ store, id, renders }: { store: ExpandedParts; id: string; renders: Record<string, number> }) {
  const [open, setOpen] = usePartOpen(store, id);
  renders[id] = (renders[id] ?? 0) + 1;
  return (
    <button type="button" data-part={id} data-open={String(open)} onClick={() => setOpen(!open)}>
      {id}
    </button>
  );
}

describe("раскрытые части ответа", () => {
  it("переключение перерисовывает только свою часть", () => {
    const renders: Record<string, number> = {};
    const stores: ExpandedParts[] = [];
    function Host() {
      const store = useExpandedParts("c1");
      stores[0] = store;
      return (
        <>
          <CountingPart store={store} id="m1:0" renders={renders} />
          <CountingPart store={store} id="m1:1" renders={renders} />
        </>
      );
    }
    const view = render(<Host />);
    const neighbourRendersBefore = renders["m1:1"];

    act(() => view.container.querySelector<HTMLButtonElement>('[data-part="m1:0"]')!.click());

    expect(view.container.querySelector('[data-part="m1:0"]')!.getAttribute("data-open")).toBe("true");
    expect(view.container.querySelector('[data-part="m1:1"]')!.getAttribute("data-open")).toBe("false");
    expect(renders["m1:1"]).toBe(neighbourRendersBefore);
  });

  it("раскрытое можно снова свернуть", () => {
    const renders: Record<string, number> = {};
    function Host() {
      return <CountingPart store={useExpandedParts("c1")} id="m1:0" renders={renders} />;
    }
    const view = render(<Host />);
    const button = () => view.container.querySelector<HTMLButtonElement>("[data-part]")!;

    act(() => button().click());
    expect(button().getAttribute("data-open")).toBe("true");
    act(() => button().click());
    expect(button().getAttribute("data-open")).toBe("false");
  });

  it("смена chatId сбрасывает всё", () => {
    const renders: Record<string, number> = {};
    function Host({ chatId }: { chatId: string }) {
      return <CountingPart store={useExpandedParts(chatId)} id="m1:0" renders={renders} />;
    }
    const view = render(<Host chatId="c1" />);
    act(() => view.container.querySelector<HTMLButtonElement>("[data-part]")!.click());
    expect(view.container.querySelector("[data-part]")!.getAttribute("data-open")).toBe("true");

    view.rerender(<Host chatId="c2" />);

    expect(view.container.querySelector("[data-part]")!.getAttribute("data-open")).toBe("false");
  });

  it("тот же chatId — хранилище то же, раскрытое живёт между перерисовками", () => {
    const { result, rerender } = renderHook(({ chatId }) => useExpandedParts(chatId), { initialProps: { chatId: "c1" } });
    const first = result.current;
    act(() => first.setOpen(partKey("m1", 0), true));

    rerender({ chatId: "c1" });

    expect(result.current).toBe(first);
    expect(result.current.isOpen(partKey("m1", 0))).toBe(true);
  });
});
