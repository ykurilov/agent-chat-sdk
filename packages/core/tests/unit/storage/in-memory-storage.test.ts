import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { describeChatStorageContract } from "../../../src/storage/storage-contract";

describeChatStorageContract(() => createInMemoryChatStorage(), { choiceMemory: "required", voiceDialog: "required", memory: "required", memoryOptimization: "required", spendingLimitState: "required", subjectChats: "required", chatData: "required", importChat: "required", afterTurnState: "required", chatClosure: "required", partsOfTypes: "required" });
