// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it } from "vitest";
import { createSkills, createSkillsHandler } from "../../src/index";
import { russianSkillsLabels as labels, SkillsAdmin } from "../../src/react";
import type { SkillsSkin, SkillStatus } from "../../src/react";
import { memorySkillStore } from "../../src/store/memory";

afterEach(cleanup);

const stubSkin: SkillsSkin = {
  SkillsLayout: ({ list, detail }) => (
    <div>
      <nav aria-label="list">{list}</nav>
      <main aria-label="detail">{detail}</main>
    </div>
  ),
  SkillList: ({ state, items, onCreate }) => (
    <div>
      <span>{`list:${state}`}</span>
      <button onClick={onCreate}>new</button>
      {items.map((item) => (
        <button key={item.name} onClick={item.onSelect}>{`${item.name} ${item.status} v${item.version} loads:${item.loads}`}</button>
      ))}
    </div>
  ),
  SkillPanel: ({ state, editor, versions, loads }) => (
    <div>
      <span>{`panel:${state}`}</span>
      {editor}
      {versions}
      {loads}
    </div>
  ),
  SkillEditor: (props) => (
    <form aria-label="editor" onSubmit={(event) => event.preventDefault()}>
      <span>{`mode:${props.mode} version:${props.version ?? "-"}`}</span>
      {props.onNameChange && <input aria-label="name" value={props.name} onChange={(event) => props.onNameChange!(event.target.value)} />}
      <input aria-label="whenToUse" value={props.whenToUse} onChange={(event) => props.onWhenToUseChange(event.target.value)} />
      <textarea aria-label="body" value={props.body} onChange={(event) => props.onBodyChange(event.target.value)} />
      <select aria-label="status" value={props.status} onChange={(event) => props.onStatusChange(event.target.value as SkillStatus)}>
        <option value="off">off</option>
        <option value="admins">admins</option>
        <option value="everyone">everyone</option>
      </select>
      <button onClick={props.onSave} disabled={!props.canSave || props.saving || !props.dirty}>
        save
      </button>
      {props.error && <p role="alert">{props.error}</p>}
      {props.conflict && <button onClick={props.onReloadLatest}>reload</button>}
      {props.onDelete && <button onClick={props.onDelete}>delete</button>}
      {props.confirmingDelete && <button onClick={props.onConfirmDelete}>confirm</button>}
      {props.discardingDraft && (
        <>
          <button onClick={props.onConfirmDiscard}>discard</button>
          <button onClick={props.onCancelDiscard}>stay</button>
        </>
      )}
    </form>
  ),
  SkillVersions: ({ versions }) => (
    <ul aria-label="versions">
      {versions.map((version) => (
        <li key={version.version}>
          {`v${version.version} ${version.author}${version.current ? " current" : ""}`}
          <button onClick={() => version.onOpenChange(!version.open)}>{`changes v${version.version}`}</button>
          {version.onRollback && <button onClick={version.onRollback}>{`rollback v${version.version}`}</button>}
          {version.bodyDiff?.map((line, index) => (
            <code key={index}>{`${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : "="}${line.text}`}</code>
          ))}
        </li>
      ))}
    </ul>
  ),
  SkillLoads: ({ total, recent }) => <p>{`total:${total} ${recent.map((load) => `${load.chatId}/${load.ownerId}/v${load.version}`).join(",")}`}</p>,
  SkillsNotFound: () => <p>not-found</p>,
};

function setup(user = "boss", store = memorySkillStore()) {
  const skills = createSkills({ store, isAdmin: ({ id }) => id === "boss", chatStorage: createInMemoryChatStorage(), log: () => {} });
  const handler = createSkillsHandler({ skills, resolveUser: () => ({ id: user }) });
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler.fetch(new Request(new URL(String(input), "http://app.test"), init))) as typeof globalThis.fetch;
  render(<SkillsAdmin skin={stubSkin} fetch={fetch} />);
  return { store };
}

const editor = () => within(screen.getByRole("form", { name: "editor" }));
const type = (label: string, value: string) => fireEvent.change(editor().getByLabelText(label), { target: { value } });

describe("SkillsAdmin", () => {
  it("не-админ: сервер отвечает 404 — экран «не найдено»", async () => {
    setup("anna");
    expect(await screen.findByText("not-found")).toBeTruthy();
  });

  it("создание, статус, правка, разница версий, откат, удаление", async () => {
    setup();
    await screen.findByText("list:ready");
    fireEvent.click(screen.getByText("new"));
    type("name", "game-dev");
    type("whenToUse", "Когда просят сделать игру.");
    type("body", "# Игры\nДелай на canvas.");
    fireEvent.click(editor().getByText("save"));
    expect(await screen.findByText("game-dev off v1 loads:0")).toBeTruthy();
    expect(await screen.findByText("mode:edit version:1")).toBeTruthy();

    fireEvent.change(editor().getByLabelText("status"), { target: { value: "everyone" } });
    expect(await screen.findByText("game-dev everyone v1 loads:0")).toBeTruthy();

    type("body", "# Игры\nДелай на Phaser.");
    fireEvent.click(editor().getByText("save"));
    expect(await screen.findByText("mode:edit version:2")).toBeTruthy();
    const versions = within(await screen.findByRole("list", { name: "versions" }));
    await waitFor(() => expect(versions.getByText("v2 boss current")).toBeTruthy());
    fireEvent.click(versions.getByText("changes v2"));
    expect(versions.getByText("-Делай на canvas.")).toBeTruthy();
    expect(versions.getByText("+Делай на Phaser.")).toBeTruthy();

    fireEvent.click(versions.getByText("rollback v1"));
    expect(await screen.findByText("mode:edit version:3")).toBeTruthy();
    expect((editor().getByLabelText("body") as HTMLTextAreaElement).value).toBe("# Игры\nДелай на canvas.");

    fireEvent.click(editor().getByText("delete"));
    fireEvent.click(editor().getByText("confirm"));
    await waitFor(() => expect(screen.queryByText(/^game-dev /)).toBeNull());
    expect(screen.getByText("panel:empty")).toBeTruthy();
  });

  it("несохранённый черновик: переход к другому навыку, «Новый» и откат сперва спрашивают; закрытие вкладки предупреждает", async () => {
    const store = memorySkillStore();
    for (const name of ["alpha", "beta"]) await store.create({ name, whenToUse: "w", body: `${name} v1`, status: "everyone", author: "boss" }, "2026-10-15T10:00:00.000Z");
    await store.updateText("alpha", { whenToUse: "w", body: "alpha v2", author: "boss", expectedVersion: 1 }, "2026-10-15T10:01:00.000Z");
    setup("boss", store);
    fireEvent.click(await screen.findByText("alpha everyone v2 loads:0"));
    await screen.findByText("mode:edit version:2");
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);

    type("body", "черновик");
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByText("beta everyone v1 loads:0"));
    fireEvent.click(editor().getByText("stay"));
    expect(screen.getByText("mode:edit version:2")).toBeTruthy();
    expect((editor().getByLabelText("body") as HTMLTextAreaElement).value).toBe("черновик");

    fireEvent.click(screen.getByText("new"));
    expect(editor().getByText("discard")).toBeTruthy();
    fireEvent.click(editor().getByText("stay"));

    const versions = within(await screen.findByRole("list", { name: "versions" }));
    fireEvent.click(versions.getByText("rollback v1"));
    expect(screen.getByText("mode:edit version:2")).toBeTruthy();
    fireEvent.click(editor().getByText("discard"));
    expect(await screen.findByText("mode:edit version:3")).toBeTruthy();
    expect((editor().getByLabelText("body") as HTMLTextAreaElement).value).toBe("alpha v1");

    type("body", "снова черновик");
    fireEvent.click(screen.getByText("beta everyone v1 loads:0"));
    fireEvent.click(editor().getByText("discard"));
    await waitFor(() => expect((editor().getByLabelText("body") as HTMLTextAreaElement).value).toBe("beta v1"));
    // Предупреждение снимает эффект React, он идёт после отрисовки: на медленной машине — позже, чем текст в поле.
    await waitFor(() => expect(unload()).toBe(false));
  });

  it("гонка правок: «навык успели изменить» и загрузка свежей версии", async () => {
    const store = memorySkillStore();
    await store.create({ name: "game-dev", whenToUse: "Игры.", body: "v1", status: "everyone", author: "boss" }, "2026-10-15T10:00:00.000Z");
    setup("boss", store);
    fireEvent.click(await screen.findByText("game-dev everyone v1 loads:0"));
    await screen.findByText("mode:edit version:1");
    await store.updateText("game-dev", { whenToUse: "Игры.", body: "чужая правка", author: "boris", expectedVersion: 1 }, "2026-10-15T11:00:00.000Z");
    type("body", "моя правка");
    fireEvent.click(editor().getByText("save"));
    fireEvent.click(await screen.findByText("reload"));
    await screen.findByText("mode:edit version:2");
    expect((editor().getByLabelText("body") as HTMLTextAreaElement).value).toBe("чужая правка");
  });

  it("ошибка проверки сервера — понятный текст; учёт загрузок в карточке", async () => {
    const { store } = setup();
    await screen.findByText("list:ready");
    fireEvent.click(screen.getByText("new"));
    type("name", "Game Dev");
    type("whenToUse", "Игры.");
    type("body", "тело");
    fireEvent.click(editor().getByText("save"));
    expect((await screen.findByRole("alert")).textContent).toBe(labels.errors.name_format);

    await store.create({ name: "seo", whenToUse: "SEO.", body: "тело", status: "everyone", author: "boss" }, "2026-10-15T10:00:00.000Z");
    await store.recordLoad({ name: "seo", version: 1, chatId: "chat-7", ownerId: "anna", turnId: "a1", loadedAt: "2026-10-15T12:00:00.000Z" });
    cleanup();
    setup("boss", store);
    fireEvent.click(await screen.findByText("seo everyone v1 loads:1"));
    expect(await screen.findByText("total:1 chat-7/anna/v1")).toBeTruthy();
  });
});

