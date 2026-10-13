// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../src/agent-panel/agent-panel";
import { ChatWorkspace } from "../src/chat-list/chat-workspace";
import type { DiagramsClient, ImagesClient, VideosClient } from "../src/agent-chat-extensions";
import type { CustomWidgetProps } from "../src/skin-contract";
import { fakeChatListServer } from "./support/fake-chat-list-server";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkspaceSkin } from "./support/stub-chat-list-skin";
import { stubPanelSkin } from "./support/stub-agent-panel-skin";
import { AgentPanelProvider } from "../src/agent-panel/agent-panel-provider";

setupChatDom();

const PickSlot: ComponentType<CustomWidgetProps<{ slots: string[] }, { slot: string }>> = () => null;
const widgets = { pick_slot: PickSlot };
const diagrams: DiagramsClient = { render: async () => ({ error: "нет" }) };
const images: ImagesClient = { toolName: "generate_images", describe: () => undefined };
const videos: VideosClient = { toolName: "show_video", describe: () => undefined };

const history = [
  { id: "m1", role: "user" as const, parts: [{ type: "text", text: "Привет" }] },
  { id: "m2", role: "assistant" as const, parts: [{ type: "text", text: "Здравствуйте" }], metadata: { status: "complete" } },
];

describe("widgets, diagrams, images, videos: необязательные свойства сквозь слои (SC-005)", () => {
  it("AgentChat с новыми свойствами рисует то же и просит у сервера то же, что без них", async () => {
    const plain = fakeChatServer({ history });
    const first = renderAgentChat(plain);
    await screen.findByText("Здравствуйте");
    const plainHtml = first.container.innerHTML;
    const plainCalls = plain.requests.map((request) => `${request.method} ${request.url}`);
    first.unmount();

    const extended = fakeChatServer({ history });
    const second = renderAgentChat(extended, { widgets, diagrams, images, videos });
    await screen.findByText("Здравствуйте");
    expect(second.container.innerHTML).toBe(plainHtml);
    expect(extended.requests.map((request) => `${request.method} ${request.url}`)).toEqual(plainCalls);
  });

  it("ChatWorkspace принимает свойства и передаёт открытому чату", async () => {
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} widgets={widgets} diagrams={diagrams} images={images} videos={videos} />);
    expect(await screen.findByLabelText("поле")).toBeTruthy();
  });

  it("AgentPanel принимает свойства", async () => {
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch);
    render(
      <AgentPanelProvider api="/api/chat" userKey="ivan">
        <AgentPanel skin={stubPanelSkin} widgets={widgets} diagrams={diagrams} images={images} videos={videos} />
      </AgentPanelProvider>,
    );
    expect(await screen.findByLabelText("поле")).toBeTruthy();
  });
});
