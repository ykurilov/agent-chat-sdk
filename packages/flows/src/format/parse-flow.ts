import { z } from "zod";
import { AGENT_FLOW_FORMAT, AGENT_FLOW_FORMAT_VERSION, type FlowFormatError, type ParseFlowResult } from "./flow-format";
import { agentFlowSchema } from "./flow-schema";
import { migrateFlow } from "./migrate-flow";

const russianMessages = z.locales.ru().localeError;

const OTHERWISE_REMOVED =
  "Условия «иначе» больше нет (поле `otherwise`): если ни одно условие не сработало, агент остаётся в состоянии. " +
  "Общее для всех состояний — цены, условия, тон — пишется в `common`.";

/**
 * Разбирает сценарий: объект или строку JSON. Старые версии формата переводит в текущую,
 * пропущенные значения дополняет. Проверяет только форму; связи между состояниями проверяет `checkFlow`.
 */
export function parseFlow(input: unknown): ParseFlowResult {
  let json = input;
  if (typeof input === "string") {
    try {
      json = JSON.parse(input);
    } catch (error) {
      return failure("", `Это не JSON: ${(error as Error).message}`);
    }
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return failure("", "Сценарий — это объект JSON.");
  }
  const raw = json as Record<string, unknown>;
  if (raw.format !== AGENT_FLOW_FORMAT) {
    return failure("format", `Это не сценарий agent-flow: у сценария должно быть поле "format": "${AGENT_FLOW_FORMAT}".`);
  }
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return failure("version", "Номер версии формата (`version`) — целое число от 1.");
  }
  if (version > AGENT_FLOW_FORMAT_VERSION) {
    return failure(
      "version",
      `Сценарий записан в версии формата ${version}, а этот SDK знает версии до ${AGENT_FLOW_FORMAT_VERSION}: обновите SDK.`,
    );
  }

  const parsed = agentFlowSchema.safeParse(migrateFlow(raw, version), { error: russianMessages });
  if (parsed.success) return { ok: true, flow: parsed.data };
  return { ok: false, errors: parsed.error.issues.flatMap(formatIssue) };
}

function formatIssue(issue: z.core.$ZodIssue): FlowFormatError[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: formatPath([...issue.path, key]),
      message: key === "otherwise" ? OTHERWISE_REMOVED : `Неизвестное поле «${key}».`,
    }));
  }
  if (issue.code === "invalid_union" && issue.discriminator) {
    // Варианты zod кладёт в ошибку, но в типе их нет.
    const options = (issue as { options?: readonly unknown[] }).options ?? [];
    const known = options.map((option) => `«${String(option)}»`).join(", ");
    return [{ path: formatPath(issue.path), message: `Неизвестное значение поля «${issue.discriminator}». Можно: ${known}.` }];
  }
  return [{ path: formatPath(issue.path), message: issue.message }];
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === "number") return `${text}[${key}]`;
    return text ? `${text}.${String(key)}` : String(key);
  }, "");
}

function failure(path: string, message: string): ParseFlowResult {
  return { ok: false, errors: [{ path, message }] };
}
