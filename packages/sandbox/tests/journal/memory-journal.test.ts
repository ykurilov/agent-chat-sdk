import { describe } from "vitest";
import { createMemoryJournalStore } from "../../src/journal/memory-journal";
import { createSandboxJournal } from "../../src/journal/journal";
import { describeSandboxJournalContract } from "./journal-contract";

describe("журнал в памяти", () => {
  describeSandboxJournalContract(async (options) => {
    const store = createMemoryJournalStore();
    return { journal: createSandboxJournal(store, options), blobCount: async () => store.blobCount() };
  });
});
