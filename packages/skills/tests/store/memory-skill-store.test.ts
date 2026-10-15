import { describe } from "vitest";
import { memorySkillStore } from "../../src/store/memory";
import { describeSkillStoreContract } from "./skill-store-contract";

describe("навыки в памяти", () => {
  describeSkillStoreContract(async () => {
    const store = memorySkillStore();
    return { first: store, second: store, close: async () => {} };
  });
});
