// Пакет видео агента (docs/videos.md): инструменты `find_videos` и `show_video` поверх каталога приложения.
export { createVideoLibrary } from "./create-video-library";
export type { CreateVideoLibraryOptions, ShownVideo, VideoContext, VideoLibrary, VideoLibraryModel, VideoSource } from "./create-video-library";
export { searchVideos } from "./video-catalog";
export type { VideoEntry } from "./video-catalog";
export { embedUrl, isVideoAddress, parseVideoUrl, watchUrl } from "./video-address";
export type { VideoAddress, VideoProvider } from "./video-address";
export { timeLabel } from "./time-label";
