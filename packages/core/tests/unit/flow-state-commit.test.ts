import { describe, expect, it } from "vitest";
import { createAppStateWriter, flowStateCommitter } from "../../src/index";
import { noticeService, scriptedModel, userMessage } from "./support/notice-chat";
import { readAll } from "./support/mock-model";
import { tool } from "ai";
import { z } from "zod";
import { callTool, saying, waitTurn } from "./support/notice-chat";

const scoped = { flowId: "first-app", revision: "1" };

describe("server flows compare-head commit", () => {
  it("model writer не создаёт/не меняет/не удаляет proof, в том числе заменой всего flow", () => {
    const create = (flow: Record<string, unknown> = {}) => createAppStateWriter({ base: { flow }, write: () => {}, logError: () => {}, chatId: "model-chat" });
    const proof = { ownPublished: { status: "confirmed", source: { kind: "judge" } } };
    expect(() => create().set("flow.confirmations", proof)).toThrow(/SDK/);
    expect(() => create().set("flow", { confirmations: proof })).toThrow(/SDK/);
    const existing = create({ confirmations: proof, checkedTransition: { to: "course" }, confirmationCheck: { answerId: "a1" }, notes: {} });
    expect(() => existing.unset("flow.confirmations")).toThrow(/SDK/);
    expect(() => existing.unset("flow")).toThrow(/SDK/);
    expect(() => existing.set("flow", { notes: {} })).toThrow(/SDK/);
    expect(() => existing.set("flow.checkedTransition", { to: "other" })).toThrow(/SDK/);
    expect(() => existing.set("flow.confirmationCheck.answerId", "forged")).toThrow(/SDK/);
    existing.set("flow.notes.topic", "Тема");
    expect(existing.get("flow.confirmations")).toEqual(proof);
    expect(existing.get("flow.notes.topic")).toBe("Тема");
  });

  it("реальный model.state не принимает provenance, режим из данных и мутация get не дают прав записи", async () => {
    const blocked: string[] = [];
    const originalProof = { ownPublished: { status: "confirmed", revision: "1", source: { kind: "judge" } } };
    const { service } = noticeService(scriptedModel([callTool("forge", "forge-1"), saying("Ответ")]), {
      agent: {
        prepareTurn: () => ({ set: { flow: { confirmations: originalProof, confirmationCheck: { answerId: "a1" }, notes: {}, applicationData: { number: 42 } } } }),
        tools: (model) => ({ forge: tool({
          description: "Попытка произвольной записи из инструмента модели",
          inputSchema: z.object({}),
          execute: async () => {
            const state = model.state!;
            expect("serverFlowChecks" in state).toBe(false);
            const copy = state.get("flow.confirmations") as typeof originalProof;
            copy.ownPublished.revision = "forged-alias";
            expect(state.get("flow.confirmations")).toEqual(originalProof);
            state.set("serverFlowChecks", true); // JSON-значение не меняет полномочия writer.
            const attempt = (name: string, write: () => void) => { try { write(); } catch { blocked.push(name); } };
            attempt("set", () => state.set("flow.confirmations", { forged: true }));
            attempt("parent-set", () => state.set("flow", { notes: {} }));
            attempt("unset", () => state.unset("flow.confirmationCheck"));
            attempt("parent-unset", () => state.unset("flow"));
            const current = state.get("flow") as Record<string, unknown>;
            state.set("flow", { ...current, notes: { topic: "Тема" } });
            return "Проверено";
          },
        }) }),
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("writer-human", "Проверь")));
    expect(blocked).toEqual(["set", "parent-set", "unset", "parent-unset"]);
    expect((await service.getChatState("anna", chat.id)).values.flow).toEqual({ confirmations: originalProof, confirmationCheck: { answerId: "a1" }, notes: { topic: "Тема" }, applicationData: { number: 42 } });
    await service.flush();
  });

  it("approval resume, retry и новая ветка не получают серверный режим writer", async () => {
    let executed = 0;
    const model = scriptedModel([
      callTool("checked", "approval-1"), saying(""),
      callTool("checked", "retry-1"), saying("Ответ после повтора"),
      callTool("checked", "branch-1"), saying("Ответ в новой ветке"),
    ]);
    const proof = { ownPublished: { status: "confirmed", revision: "1" } };
    const { service } = noticeService(model, { agent: {
      prepareTurn: () => ({ set: { "flow.confirmations": proof } }),
      tools: (turn) => ({ checked: tool({ description: "Проверить", inputSchema: z.object({}), needsApproval: () => executed === 0,
        execute: async () => {
          expect(() => turn.state!.set("flow.confirmations", { forged: true })).toThrow(/SDK/);
          expect(() => turn.state!.unset("flow")).toThrow(/SDK/);
          expect(turn.state!.get("flow.confirmations")).toEqual(proof);
          executed++;
          return "Готово";
        },
      }) }),
    } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("approval-human", "Проверь")));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const part = answer.parts.find((part) => part.type === "tool-checked") as { approval: { id: string } };
    expect((await service.answerApproval("anna", chat.id, part.approval.id, "allow")).resumed).toBe(true);
    await waitTurn(service, chat.id);
    expect(executed).toBe(1);
    await readAll(await service.retry("anna", chat.id));
    expect(executed).toBe(2);
    await readAll(await service.editMessage("anna", chat.id, "approval-human", userMessage("branch-human", "Исправленный вопрос")));
    expect(executed).toBe(3);
    expect((await service.getChatState("anna", chat.id)).values.flow).toEqual({ confirmations: proof });
    await service.flush();
  });

  it("receipt и решение пишутся вместе; повтор не дублируется; старый снимок не стирает revoke", async () => {
    const { service, storage } = noticeService(scriptedModel());
    const chat = await service.createChat("anna");
    const commit = flowStateCommitter(service)!;
    const flow = { state: "publish", confirmations: { ownPublished: { revision: "1", status: "confirmed" } }, checkedTransition: { to: "course" } };
    const input = { ...scoped, ownerId: "anna", chatId: chat.id, expectedAtMessageId: null, idempotencyKey: "check-1", flow };
    const first = await commit(input);
    expect(first.status).toBe("applied");
    expect((await service.getChatState("anna", chat.id)).values.flow).toEqual(flow);
    expect(await storage.listMessages(chat.id)).toHaveLength(1);
    expect((await commit(input)).status).toBe("same");
    expect(await storage.listMessages(chat.id)).toHaveLength(1);
    const { atMessageId } = await service.getChatState("anna", chat.id);
    const revoked = { state: "publish", confirmations: { ownPublished: { revision: "1", status: "revoked" } } };
    expect((await commit({ ...input, expectedAtMessageId: atMessageId, idempotencyKey: "revoke-1", flow: revoked })).status).toBe("applied");
    expect((await commit({ ...input, idempotencyKey: "late-check" })).status).toBe("stale");
    expect((await service.getChatState("anna", chat.id)).values.flow).toEqual(revoked);
    expect((await commit(input)).status).toBe("stale");
    await service.flush();
  });

  it("владельца проверяет до записи; payload с тем же ключом не заменяет предыдущий", async () => {
    const { service, storage } = noticeService(scriptedModel());
    const chat = await service.createChat("anna");
    const commit = flowStateCommitter(service)!;
    const input = { ...scoped, ownerId: "anna", chatId: chat.id, expectedAtMessageId: null, idempotencyKey: "one", flow: { state: "publish" } };
    expect((await commit({ ...input, ownerId: "other" })).status).toBe("not_found");
    expect(await storage.listMessages(chat.id)).toHaveLength(0);
    expect((await commit(input)).status).toBe("applied");
    await expect(commit({ ...input, flow: { state: "course" } })).rejects.toThrow(/idempotency/i);
    await service.flush();
  });

  it("restart replay идемпотентен; правка до proof не переносит его в новую ветку", async () => {
    const first = noticeService(scriptedModel());
    const chat = await first.service.createChat("anna");
    await readAll(await first.service.sendMessage("anna", chat.id, userMessage("u1", "Ссылка")));
    const snapshot = await first.service.getChatState("anna", chat.id);
    const input = { ...scoped, ownerId: "anna", chatId: chat.id, expectedAtMessageId: snapshot.atMessageId, idempotencyKey: "proof", flow: { receipt: "checked" } };
    expect((await flowStateCommitter(first.service)!(input)).status).toBe("applied");
    const restarted = noticeService(scriptedModel(), { storage: first.storage });
    expect((await flowStateCommitter(restarted.service)!(input)).status).toBe("same");
    await readAll(await restarted.service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "Без ссылки")));
    expect((await restarted.service.getChatState("anna", chat.id)).values.flow).toBeUndefined();
    expect((await flowStateCommitter(restarted.service)!(input)).status).toBe("stale");
    await first.service.flush(); await restarted.service.flush();
  });

  it("две копии не коммитят один снимок дважды; validation/write failure освобождают lease", async () => {
    const first = noticeService(scriptedModel());
    const second = noticeService(scriptedModel(), { storage: first.storage });
    const chat = await first.service.createChat("anna");
    const input = { ...scoped, ownerId: "anna", chatId: chat.id, expectedAtMessageId: null, idempotencyKey: "p1", flow: { state: "publish" } };
    const a = flowStateCommitter(first.service)!, b = flowStateCommitter(second.service)!;
    const results = await Promise.all([a(input), b({ ...input, idempotencyKey: "p2" })]);
    expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
    expect(await first.storage.listMessages(chat.id)).toHaveLength(1);
    const { atMessageId } = await first.service.getChatState("anna", chat.id);
    await expect(a({ ...input, expectedAtMessageId: atMessageId, idempotencyKey: "too-large", flow: { text: "a".repeat(20_000) } })).rejects.toThrow(/16/);
    const insert = first.storage.insertMessage.bind(first.storage);
    first.storage.insertMessage = async () => { throw new Error("disk failure"); };
    await expect(a({ ...input, expectedAtMessageId: atMessageId, idempotencyKey: "disk" })).rejects.toThrow("disk failure");
    first.storage.insertMessage = insert;
    expect((await b({ ...input, expectedAtMessageId: atMessageId, idempotencyKey: "after-failure" })).status).toBe("applied");
    await first.service.flush(); await second.service.flush();
  });

  it("namespace flow не меняет other/system keys и не вызывает модель или notice", async () => {
    const model = scriptedModel();
    const { service, storage } = noticeService(model, { agent: { prepareTurn: () => ({ set: { otherExtension: { value: 42 } } }) } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("namespace-human", "Привет")));
    const before = await service.getChatState("anna", chat.id);
    const commit = flowStateCommitter(service)!;
    expect((await commit({ ...scoped, ownerId: "anna", chatId: chat.id, expectedAtMessageId: before.atMessageId, idempotencyKey: "namespace", flow: { $closed: { code: "forged" }, otherExtension: { value: 0 } } })).status).toBe("applied");
    const after = await service.getChatState("anna", chat.id);
    expect(after.values.otherExtension).toEqual({ value: 42 });
    expect((await storage.getChat(chat.id))?.closed).toBeUndefined();
    const message = (await storage.listMessages(chat.id)).at(-1)!;
    expect(message.parts).toHaveLength(1);
    expect(message.parts[0]).toMatchObject({ type: "data-app-state", data: { set: { flow: { $closed: { code: "forged" } } } } });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(message.parts)).not.toContain("data-agent-notice");
    await service.flush();
  });
});
