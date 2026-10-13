import { describe } from "vitest";
import { createMemoryMessengerStore } from "../../src/index";
import { describeMessengerStoreContract } from "./messenger-store-contract";

describe("хранилище мессенджеров в памяти", () => {
  describeMessengerStoreContract(async () => createMemoryMessengerStore());
});
