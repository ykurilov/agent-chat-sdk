// Проверки ответа агента для `replyChecks` службы чата. Подключаются к любому приложению, без сценария тоже.
export { foreignWords, type ForeignWordsOptions } from "./foreign-words";
export { unknownLinks, type UnknownLinksOptions } from "./unknown-links";
export { englishReplyCheckLabels, russianReplyCheckLabels, type ReplyCheckLabels } from "./labels";
export type { ReplyCheck, ReplyCheckInput, ReplyCheckResult } from "@ykurilov/agent-chat-core";
