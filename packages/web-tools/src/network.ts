// Сетевой доступ сервера к адресам извне — только для сервера, без инструментов и служб пакета: им пользуются
// и другие пакеты (картинки, MCP), чтобы проверка адреса и соединение были одни.
export { assertPublicWebAddress, assertResolvesPublic, isHttpAddress, isPrivateAddress } from "./page-address";
export type { HostResolver } from "./page-address";
export { dnsHostResolver } from "./dns-host-resolver";
export { checkedLookup, createPinnedFetch, sharedPinnedFetch } from "./pinned-fetch";
export type { PinnedFetch } from "./pinned-fetch";
export { WebToolError } from "./web-tool-error";
export type { WebToolErrorKind } from "./web-tool-error";
