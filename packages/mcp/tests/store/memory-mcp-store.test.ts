import { describe } from "vitest";
import { createMemoryMcpStore } from "../../src/index";
import { describeMcpStoreContract } from "./mcp-store-contract";

describe("MCP в памяти", () => {
  describeMcpStoreContract(async () => {
    const store = createMemoryMcpStore();
    return { store, close: async () => {} };
  });
});
