// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { russianSkillsLabels as labels } from "@ykurilov/agent-chat-skills/react";
import type { SkillEditorProps } from "@ykurilov/agent-chat-skills/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemSkillsSkin } from "../src/skills";

afterEach(cleanup);

const { SkillEditor, SkillVersions } = tandemSkillsSkin;

function editorProps(extra: Partial<SkillEditorProps> = {}): SkillEditorProps {
  return {
    mode: "edit",
    name: "game-dev",
    whenToUse: "Когда просят сделать игру.",
    onWhenToUseChange: vi.fn(),
    body: "# Игры",
    onBodyChange: vi.fn(),
    maxWhenToUseChars: 300,
    maxBodyChars: 50_000,
    preview: false,
    onPreviewChange: vi.fn(),
    status: "everyone",
    onStatusChange: vi.fn(),
    statusBusy: false,
    version: 2,
    dirty: false,
    canSave: true,
    saving: false,
    onSave: vi.fn(),
    error: null,
    conflict: false,
    confirmingDelete: false,
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    deleting: false,
    ...extra,
  };
}

describe("экран навыков Тандема", () => {
  it("предпросмотр не исполняет HTML: нет <script>, обработчиков и ссылок javascript:", () => {
    const body = [
      "# Заголовок",
      "<script>window.hacked = true</script>",
      '<img src="x" onerror="window.hacked = true">',
      "[жми](javascript:alert(1))",
      '<a href="javascript:alert(2)">тоже</a>',
      "**жирный**",
    ].join("\n\n");
    render(<SkillEditor {...editorProps({ body, preview: true })} />);
    const preview = screen.getByTestId("skill-preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Заголовок");
    expect(preview.querySelector("strong")?.textContent).toBe("жирный");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("img[onerror]")).toBeNull();
    expect(preview.querySelector("[onerror]")).toBeNull();
    for (const link of preview.querySelectorAll("a")) expect(link.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
    expect((window as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it("клик по обезвреженной или внутренней ссылке в предпросмотре ничего не делает; внешняя открывается в новой вкладке", () => {
    const body = ["[жми](javascript:alert(1))", "[внутрь](/chat)", "[якорь](#x)", "[наружу](https://example.com)"].join("\n\n");
    render(<SkillEditor {...editorProps({ body, preview: true })} />);
    const preview = screen.getByTestId("skill-preview");
    const link = (text: string) => within(preview).getByText(text);
    // `fireEvent.click` возвращает false, если переход отменён.
    expect(fireEvent.click(link("жми"))).toBe(false);
    expect(fireEvent.click(link("внутрь"))).toBe(false);
    expect(fireEvent.click(link("якорь"))).toBe(false);
    expect(link("наружу").getAttribute("target")).toBe("_blank");
    expect(fireEvent.click(link("наружу"))).toBe(true);
  });

  it("статус — три кнопки, выбор зовёт onStatusChange; имя у существующего навыка не правится", () => {
    const props = editorProps();
    render(<SkillEditor {...props} />);
    const group = screen.getByRole("radiogroup", { name: labels.status });
    expect(within(group).getByRole("radio", { name: labels.statuses.everyone }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: labels.statuses.admins }));
    expect(props.onStatusChange).toHaveBeenCalledWith("admins");
    expect(screen.queryByLabelText(labels.name)).toBeNull();
  });

  it("гонка и подтверждение удаления", () => {
    const props = editorProps({ conflict: true, onReloadLatest: vi.fn(), onDelete: vi.fn(), confirmingDelete: true });
    render(<SkillEditor {...props} />);
    expect(screen.getByText(labels.conflict)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.reloadLatest }));
    expect(props.onReloadLatest).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: labels.deleteYes }));
    expect(props.onConfirmDelete).toHaveBeenCalledOnce();
  });

  it("разница версий — текстом, HTML из тела не исполняется", () => {
    render(
      <SkillVersions
        state="ready"
        rollingBack={false}
        onRetry={vi.fn()}
        versions={[
          {
            version: 2,
            author: "boss",
            createdAt: "15.10.2026, 12:00",
            current: true,
            open: true,
            onOpenChange: vi.fn(),
            bodyDiff: [
              { kind: "removed", text: "старое" },
              { kind: "added", text: "<img src=x onerror=alert(1)>" },
            ],
          },
        ]}
      />,
    );
    const added = document.querySelector('[data-diff="added"]')!;
    expect(added.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(added.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-diff="removed"]')?.textContent).toContain("старое");
  });
});
