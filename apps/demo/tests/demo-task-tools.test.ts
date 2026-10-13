import { describe, expect, it, vi } from "vitest";
import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import { createDemoTaskTools } from "../server/demo-task-tools";
import { createDemoTasks } from "../server/demo-tasks";

function toolsModel(patch: Partial<AgentToolsModel> = {}): AgentToolsModel {
  return { profile: {} as AgentToolsModel["profile"], providerId: "mock", chatId: "c1", ownerId: "boris", place: null, notifyDataChanged: vi.fn(), ...patch };
}

function createTask(model: AgentToolsModel, title: string) {
  const tasks = createDemoTasks();
  const result = createDemoTaskTools(tasks)(model).create_task!.execute!({ title }, { toolCallId: "t1", messages: [] });
  return { tasks, result };
}

describe("демо-инструмент create_task", () => {
  it("ход самого человека: задача создаётся у него", async () => {
    const { tasks, result } = createTask(toolsModel(), "Купить хлеб");
    expect(await result).toMatchObject({ title: "Купить хлеб" });
    expect(tasks.list("boris").map((task) => task.title)).toContain("Купить хлеб");
  });

  it("копия у сотрудника (`model.staff`): запись отказывает явным текстом, данные человека не меняются", async () => {
    const model = toolsModel({ staff: { id: "anna" } });
    const { tasks, result } = createTask(model, "Чужая задача");
    expect(await result).toEqual({ error: "В копии чата запись запрещена: данные человека не меняются." });
    expect(tasks.list("boris").map((task) => task.title)).not.toContain("Чужая задача");
    expect(model.notifyDataChanged).not.toHaveBeenCalled();
  });
});
