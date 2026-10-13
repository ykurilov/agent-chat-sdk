import { describe } from "vitest";
import { memoryTaskStore } from "../../src/index";
import { describeTaskStoreContract } from "./task-store-contract";

describe("задачи в памяти", () => {
  describeTaskStoreContract(async () => {
    const store = memoryTaskStore();
    return { first: store, second: store, close: async () => {} };
  });
});
