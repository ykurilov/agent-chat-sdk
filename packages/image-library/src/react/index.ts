// Экран библиотеки картинок: `<AgentChat images={[imagesClient, imageLibraryClient]} />`.
export { createImageLibraryClient, imageLibraryClient } from "./image-library-client";
export type { ImageLibraryClientOptions } from "./image-library-client";
// Тип клиента задаёт пакет экрана: так экран и библиотека не расходятся.
export type { ImagesClient } from "@ykurilov/agent-chat-react";
