import { createImageLibrary } from "@ykurilov/agent-chat-image-library";
import type { ImageEntry } from "@ykurilov/agent-chat-image-library";

/**
 * Библиотека готовых картинок демо: файлы лежат в `public/library`, каталог — у приложения. Каталог передан функцией:
 * она читается на каждом поиске и показе, поэтому новая запись в `demoLibraryImages` видна агенту сразу, без перезапуска
 * (так учитель добавляет картинки в живом приложении). Модель находит картинку через `find_images`, показывает через
 * `show_image`; адресов она не видит.
 */
export const demoLibraryImages: ImageEntry[] = [
  {
    id: "cell",
    title: "Строение клетки",
    alt: "Схема клетки: ядро в центре, митохондрии и мембрана по краю",
    url: "/library/cell.svg",
    width: 1200,
    height: 800,
    description: "Из чего состоит живая клетка: ядро, цитоплазма, митохондрии, мембрана.",
    concepts: ["клетка", "органоиды"],
    tags: ["биология"],
  },
  {
    id: "atom",
    title: "Модель атома",
    alt: "Ядро атома и три электрона на орбитах",
    url: "/library/atom.svg",
    width: 800,
    height: 800,
    description: "Планетарная модель: ядро в центре, электроны вращаются вокруг.",
    concepts: ["атом", "электрон"],
    tags: ["физика"],
  },
];

export const demoImageLibrary = createImageLibrary({ images: () => demoLibraryImages, logError: (message) => console.error(message) });
