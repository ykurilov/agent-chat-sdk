import { AGENT_FLOW_FORMAT_VERSION } from "./flow-format";

type FlowJson = Record<string, unknown>;

/**
 * Шаги перевода сценария: ключ — версия, из которой шаг переводит в следующую.
 * Новая версия формата добавляет сюда шаг «N → N+1», старые сценарии продолжают открываться.
 */
const FORMAT_STEPS: Readonly<Record<number, (flow: FlowJson) => FlowJson>> = {
  // 1 → 2: новые поля («Дни и время», касания, «нода длится», «да/нет», попутные задачи) необязательные,
  // без них сценарий ведёт себя как в версии 1. Меняется только номер версии.
  1: (flow) => flow,
};

/** Переводит JSON сценария из версии `from` в текущую. Вызывающий проверил, что `from` не новее текущей. */
export function migrateFlow(flow: FlowJson, from: number): FlowJson {
  let current = flow;
  for (let version = from; version < AGENT_FLOW_FORMAT_VERSION; version += 1) {
    const step = FORMAT_STEPS[version];
    if (!step) throw new Error(`Нет шага перевода формата сценария с версии ${version}.`);
    current = { ...step(current), version: version + 1 };
  }
  return current;
}
