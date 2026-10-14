// Два маленьких сценария для проверки перевода чатов: v2 убирает состояние «parked» и добавляет «waiting».
// Любое сообщение человека двигает чат на шаг: intro → work → parked → done.

const state = (id: string, title: string, to?: string) => ({
  id,
  title,
  instructions: `Состояние «${title}».`,
  ...(to && { exits: [{ id: `${id}_next`, when: { type: "event", event: "message" }, to }] }),
});

const base = (version: number, states: ReturnType<typeof state>[]) => ({
  format: "agent-flow",
  version: 1,
  id: "mini",
  name: `Мини v${version}`,
  start: "intro",
  common: `Ты — помощник. Версия ${version}.`,
  clientCard: [],
  chatNotes: [],
  tools: [],
  states,
});

export const miniV1 = () =>
  base(1, [state("intro", "Знакомство", "work"), state("work", "Работа", "parked"), state("parked", "Отложено", "done"), state("done", "Готово")]);

/** «Отложено» убрано, появилось «Ожидание»; «Работа» теперь ведёт в «Ожидание». */
export const miniV2 = () => base(2, [state("intro", "Знакомство", "work"), state("work", "Работа", "waiting"), state("waiting", "Ожидание", "done"), state("done", "Готово")]);
