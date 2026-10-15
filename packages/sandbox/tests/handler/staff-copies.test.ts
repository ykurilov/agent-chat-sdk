import type { AgentToolsModel, AgentViewerInput, Chat, TurnResult } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createStaffCopies, STAFF_COPIES_REMEMBERED, staffCopySubjectData } from "../../src/people/staff-copies";

const chat = (id: string, ownerId: string, subjectKey?: string) => ({ id, ownerId, ...(subjectKey && { subjectKey }) }) as Chat;

describe("копии чатов людей: сотрудник хода", () => {
  it("ключ копии у чата обычного владельца — не копия: сотрудника нет", () => {
    const copies = createStaffCopies();
    expect(copies.staffOf(chat("c1", "vera", "staff-copy:gleb:c0:1"))).toBeNull();
    expect(copies.personOf("c1")).toBeUndefined();
    expect(copies.staffOf(chat("c2", "sandbox:anna", "staff-copy:gleb:c0:1"))).toEqual({ id: "anna" });
    expect(copies.personOf("c2")).toBe("gleb");
  });

  it("помнит не больше заданного числа копий: давно не ходившие забываются", () => {
    const copies = createStaffCopies();
    for (let index = 0; index <= STAFF_COPIES_REMEMBERED; index++) copies.staffOf(chat(`c${index}`, "sandbox:anna", `staff-copy:vera:p${index}:1`));
    expect(copies.personOf("c0")).toBeUndefined();
    expect(copies.personOf("c1")).toBe("vera");
    expect(copies.personOf(`c${STAFF_COPIES_REMEMBERED}`)).toBe("vera");
  });
});

describe("копии чатов людей: объект исходного чата", () => {
  const lesson = { key: "lesson:42", data: { lessonId: 42 } };
  const copySubject = { key: "staff-copy:vera:c0:1", data: staffCopySubjectData(lesson) };
  const model = (fields: Partial<AgentToolsModel>) => ({ chatId: "copy", ownerId: "sandbox:anna", ...fields }) as AgentToolsModel;
  const turn = (fields: Partial<TurnResult>) =>
    ({ ownerId: "sandbox:anna", actorId: "sandbox:anna", chatId: "copy", messageId: "m1", status: "complete", recovered: true, ...fields }) as TurnResult;

  it("инструменты копии вне хода (сжатие, без `staff`) — тоже человек, сотрудник и исходный объект", () => {
    const copies = createStaffCopies();
    expect(copies.toolsModel(model({ subject: copySubject }))).toMatchObject({ ownerId: "vera", staff: { id: "anna" }, subject: lesson });
    expect(copies.toolsModel(model({ subject: { key: "lesson:7" } }))).toMatchObject({ ownerId: "anna", subject: { key: "lesson:7" } });
    expect(copies.toolsModel(model({}))).not.toHaveProperty("staff");
  });

  it("права (`agent.viewer`) — по владельцу чата, как у инструментов: в копии человек, в песочном чате настоящий админ", () => {
    const copies = createStaffCopies();
    const input = (fields: Partial<AgentViewerInput>) =>
      ({ userId: "sandbox:anna", chatId: "copy", ownerId: "sandbox:anna", messageId: "m1", chat: {}, channel: "web", audience: "private", abortSignal: new AbortController().signal, ...fields }) as AgentViewerInput;
    expect(copies.viewerInput(input({ subject: copySubject, chat: { data: copySubject.data } }))).toMatchObject({ ownerId: "vera", userId: "anna", staff: { id: "anna" }, subject: lesson, chat: { data: lesson.data } });
    expect(copies.viewerInput(input({}))).toMatchObject({ ownerId: "anna", userId: "anna" });
    expect(copies.viewerInput(input({}))).not.toHaveProperty("staff");
  });

  it("итог, доделанный после перезапуска, в копии — исходный объект человека; в обычном песочном чате хук не зовётся", async () => {
    const seen: TurnResult[] = [];
    const afterTurn = createStaffCopies().afterTurn((result) => void seen.push(result));
    await afterTurn(turn({ subject: copySubject, staff: { id: "anna" }, actorId: "anna" }));
    await afterTurn(turn({ subject: { key: "staff-copy:vera:c1:1" }, staff: { id: "anna" }, actorId: "anna" }));
    await afterTurn(turn({}));
    await afterTurn(turn({ subject: { key: "lesson:7" } }));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ ownerId: "vera", actorId: "anna", staff: { id: "anna" }, subject: lesson, recovered: true });
    expect(seen[1]).toMatchObject({ ownerId: "vera", staff: { id: "anna" } });
    expect(seen[1]).not.toHaveProperty("subject");
  });

  it("данные чата в копии — данные исходного чата человека, а не служебная обёртка копии", async () => {
    const wrapper = copySubject.data;
    const tools = createStaffCopies().toolsModel(model({ subject: copySubject, chat: { data: wrapper } }));
    expect(tools.chat).toEqual({ data: lesson.data });
    const seen: TurnResult[] = [];
    await createStaffCopies().afterTurn((result) => void seen.push(result))(turn({ subject: copySubject, chatData: wrapper, staff: { id: "anna" } }));
    expect(seen[0]?.chatData).toEqual(lesson.data);
    const bare = createStaffCopies().toolsModel(model({ subject: { key: "staff-copy:vera:c1:1" }, chat: { data: wrapper } }));
    expect(bare.chat).toEqual({});
  });
});
