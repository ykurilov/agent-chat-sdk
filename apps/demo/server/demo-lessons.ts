import type { SubjectChatsResolver } from "@ykurilov/agent-chat-server";

/** Уроки демо: ключ чата объекта → данные урока для сервера, название и приветствие агента. */
const demoLessons: Record<string, { title: string; greeting: string; data: Record<string, unknown> }> = {
  "lesson:demo": {
    title: "Урок: дроби",
    greeting: "Здравствуйте! Сегодня разбираем дроби. Готовы начать с простого примера?",
    data: { lessonId: "demo", topic: "дроби" },
  },
};

/** Чат урока: известный урок — данные и приветствие; неизвестный — отказ текстом. */
export const demoSubjectChats: SubjectChatsResolver = async ({ key }) => {
  const lesson = demoLessons[key];
  if (!lesson) return { code: "unknown_lesson", message: "Такого урока нет." };
  return { title: lesson.title, greeting: { text: lesson.greeting }, data: lesson.data };
};
