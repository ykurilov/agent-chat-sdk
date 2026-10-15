/** Надписи окна перевода чатов на новую версию сценария. */
export interface FlowMigrateLabels {
  title: string;
  hint: string;
  version: string;
  state: string;
  chats: string;
  removed: string;
  target: string;
  chooseTarget: string;
  migrate: string;
  /** «Переведено чатов: 12». */
  moved: (count: number) => string;
  nothingToMigrate: string;
  close: string;
  failed: string;
}

export const russianFlowMigrateLabels: FlowMigrateLabels = {
  title: "Перевести чаты на новую версию",
  hint: "Чаты продолжат с того же состояния. Закончившиеся разговоры и тестовые чаты остаются на своей версии. Для удалённых состояний выберите, куда перевести.",
  version: "Версия",
  state: "Состояние",
  chats: "Чатов",
  removed: "удалено в новой версии",
  target: "Куда",
  chooseTarget: "Выберите состояние",
  migrate: "Перевести",
  moved: (count) => `Переведено чатов: ${count}`,
  nothingToMigrate: "Переводить нечего: идущие чаты уже на этой версии.",
  close: "Закрыть",
  failed: "Не получилось перевести. Попробуйте ещё раз",
};

export const englishFlowMigrateLabels: FlowMigrateLabels = {
  title: "Move chats to the new version",
  hint: "Chats continue from the same state. Finished conversations and test chats stay on their version. For removed states choose where to move them.",
  version: "Version",
  state: "State",
  chats: "Chats",
  removed: "removed in the new version",
  target: "Move to",
  chooseTarget: "Choose a state",
  migrate: "Move",
  moved: (count) => `Chats moved: ${count}`,
  nothingToMigrate: "Nothing to move: ongoing chats are already on this version.",
  close: "Close",
  failed: "Could not move the chats. Try again",
};
