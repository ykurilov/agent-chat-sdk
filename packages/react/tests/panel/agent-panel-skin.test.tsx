// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentPanelSkin } from "../../src/agent-panel/agent-panel-skin";
import { ChatLabelsProvider, russianLabels, useChatLabels } from "../../src/labels";

afterEach(cleanup);

/** Образец реализации договора v12: проверяет, что интерфейс описан так, как в docs/contracts/agent-panel/skin.md. */
const sampleSkin: AgentPanelSkin = {
  AgentPanelLauncher: function SampleLauncher({ open, busy, onToggle, buttonRef }) {
    const labels = useChatLabels();
    return (
      <button type="button" ref={buttonRef} aria-expanded={open} data-busy={String(busy)} onClick={onToggle}>
        {open ? labels.agentPanelClose : labels.agentPanelOpen}
      </button>
    );
  },
  AgentPanel: function SamplePanel({ open, mode, width, title, listOpen, onListOpenChange, onClose, onEscape, children, list }) {
    const labels = useChatLabels();
    return (
      <aside aria-label={labels.agentPanelLabel} hidden={!open} data-mode={mode} data-width={width} onKeyDown={(event) => event.key === "Escape" && onEscape()}>
        <h2>{title}</h2>
        <button type="button" onClick={() => onListOpenChange(!listOpen)}>
          {listOpen ? labels.agentPanelBackToChat : labels.agentPanelChats}
        </button>
        <button type="button" onClick={onClose}>
          {labels.agentPanelClose}
        </button>
        {listOpen ? list : children}
      </aside>
    );
  },
};

describe("AgentPanelSkin (договор v12)", () => {
  it("образец реализации рисуется на словаре с новыми ключами", () => {
    const { AgentPanelLauncher, AgentPanel } = sampleSkin;
    render(
      <ChatLabelsProvider labels={russianLabels}>
        <AgentPanelLauncher open={false} busy onToggle={() => {}} buttonRef={createRef<HTMLButtonElement>()} />
        <AgentPanel open mode="push" width={420} title="Новый чат" listOpen={false} onListOpenChange={() => {}} onClose={() => {}} onEscape={() => {}} list={<p>список</p>}>
          <p>чат</p>
        </AgentPanel>
      </ChatLabelsProvider>,
    );
    expect(screen.getByRole("button", { name: "Открыть агента" }).getAttribute("data-busy")).toBe("true");
    expect(screen.getByLabelText("Панель агента").getAttribute("data-mode")).toBe("push");
    expect(screen.getByText("чат")).toBeTruthy();
  });
});
