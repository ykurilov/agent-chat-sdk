import { describe, expect, it } from "vitest";
import { saying } from "../../../core/tests/unit/support/notice-chat";
import { FLOW_NOTE_TOOL } from "../../src/runtime/note-tools";
import { FLOW_SIDE_TASK_TOOL } from "../../src/runtime/side-task-tool";
import { flowChat } from "./flow-chat";

describe("служебные инструменты сценария", () => {
  it("withChat: flow_note и flow_side_task — служебные рядом со служебными приложения (не мешают подсказкам закрыть ответ)", () => {
    const chat = flowChat({ scripts: [saying("Привет")], agent: { serviceTools: ["app_mark"] } });
    expect(chat.options.agent.serviceTools).toEqual(["app_mark", FLOW_NOTE_TOOL, FLOW_SIDE_TASK_TOOL]);
  });
});
