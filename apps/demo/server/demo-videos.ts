import { createVideoLibrary } from "@ykurilov/agent-chat-videos";
import type { VideoEntry } from "@ykurilov/agent-chat-videos";

/**
 * Каталог видео демо (docs/videos.md): YouTube с главами и обложкой из демо, Kinescope без обложки (на карточке
 * заглушка). Модель находит видео через `find_videos` и показывает через `show_video`; ссылок она не видит.
 */
export const demoVideos: VideoEntry[] = [
  {
    id: "neural-networks",
    title: "Что такое нейросеть",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    description: "Короткий урок: из чего состоит нейросеть и как она учится, на примере распознавания цифр.",
    durationSeconds: 1153,
    poster: "/videos/neural-networks.svg",
    chapters: [
      { title: "Введение", startSeconds: 0 },
      { title: "Примеры", startSeconds: 200 },
      { title: "Слои", startSeconds: 480 },
    ],
  },
  {
    id: "vibe-coding-webinar",
    title: "Секреты вайб-кодинга и автоматизации",
    url: "https://kinescope.io/gPhDX2pPFyCG77vboYnRCZ",
    description: "Вебинар: как поручать код агентам и автоматизировать рутину.",
    durationSeconds: 5400,
  },
  {
    id: "gradient-descent",
    title: "Градиентный спуск: как нейросеть учится",
    url: "https://youtu.be/IHZwWFHWa-w",
    description: "Продолжение урока про нейросети: как сеть подбирает веса, чтобы ошибаться меньше.",
    durationSeconds: 1260,
  },
];

export const demoVideoLibrary = createVideoLibrary({ videos: demoVideos, logError: (message) => console.error(message) });
