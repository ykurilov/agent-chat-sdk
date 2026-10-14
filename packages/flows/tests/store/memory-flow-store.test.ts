import { describe, expect, it } from "vitest";
import { memoryFlowStore } from "../../src/index";
import { at, chatInput, describeFlowStoreContract } from "./flow-store-contract";

describe("сценарии в памяти", () => {
  describeFlowStoreContract(async () => {
    const store = memoryFlowStore();
    return { first: store, second: store, close: async () => {} };
  });

  it("отданные записи — копии: правка снаружи не меняет хранилище", async () => {
    const store = memoryFlowStore();
    const input = chatInput();
    const pinned = await store.pinChat(input);
    pinned.pending.push({ kind: "event", key: "k", name: "x", at: at(1) });
    pinned.stateId = "чужое";
    expect(await store.getChat(input.chatId)).toMatchObject({ stateId: "intro", pending: [] });
    const value = { list: [1] };
    await store.writeCardField({ ownerId: "anna", fieldId: "f", value, chatId: "c", flowId: "f", at: at(1) });
    value.list.push(2);
    (await store.readCard("anna"))[0]!.value = "чужое";
    expect((await store.readCard("anna"))[0]?.value).toEqual({ list: [1] });
  });
});
