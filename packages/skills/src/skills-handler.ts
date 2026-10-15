import { allowedUser, createRequestOriginCheck, isSafeMethod, originRefusalHint } from "@ykurilov/agent-chat-core";
import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import type { Skills } from "./create-skills";
import { InvalidSkillError, MAX_WHEN_TO_USE_CHARS } from "./skill-rules";
import { SkillExistsError, SkillNotFoundError, SkillVersionConflictError } from "./types";

export interface CreateSkillsHandlerOptions {
  skills: Skills;
  /** Тот же, что у чата приложения: кто делает запрос. Админ ли он — решает `isAdmin` из `createSkills`. */
  resolveUser(request: Request): ResolvedUser | Promise<ResolvedUser>;
  /** По умолчанию `/api/skills`. */
  basePath?: string;
  /** Чужие сайты, которым можно менять навыки с куками админа (как `allowedOrigins` чата). */
  allowedOrigins?: readonly string[];
  logError?: (message: string) => void;
}

export interface SkillsHandler {
  basePath: string;
  fetch(request: Request): Promise<Response>;
}

/**
 * Самое большое тело запроса: тело и `whenToUse` в пределе — до 6 байт на знак (так JSON пишет управляющие символы),
 * плюс запас на остальные поля; не меньше 256 КБ.
 */
function maxRequestBytes(maxBodyChars: number): number {
  return Math.max(256 * 1024, (maxBodyChars + MAX_WHEN_TO_USE_CHARS) * 6 + 16 * 1024);
}

class BadRequestError extends Error {}
class BodyTooLargeError extends Error {}

/**
 * Адреса админ-экрана навыков. Не-админ, гость и отказ приложения получают 404 на любом адресе: чужой не узнает, что
 * навыки есть. Запись с чужого сайта — 403 (только админу, после проверки). Ошибки — `{ error: { kind, message } }`.
 */
export function createSkillsHandler(options: CreateSkillsHandlerOptions): SkillsHandler {
  const { skills } = options;
  const manage = skills.manage;
  const requestLimit = maxRequestBytes(skills.maxBodyChars);
  const basePath = (options.basePath ?? "/api/skills").replace(/\/+$/, "");
  const logError = options.logError ?? ((message: string) => console.error(message));
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: options.allowedOrigins,
    onRefused: (refusal) => logError(`Навыки: ${originRefusalHint(refusal)}`),
  });

  async function route(request: Request, segments: string[], author: string): Promise<Response | null> {
    const [name, action, ...rest] = segments;
    if (rest.length > 0) return null;
    const method = request.method;
    if (name === undefined) {
      if (method === "GET") {
        return Response.json({ skills: await manage.list() });
      }
      if (method === "POST") {
        const input = await readObject(request, requestLimit);
        const skill = await manage.create(
          { name: text(input, "name"), whenToUse: text(input, "whenToUse"), body: text(input, "body"), status: optionalText(input, "status") },
          author,
        );
        return Response.json({ skill }, { status: 201 });
      }
      return null;
    }
    if (action === undefined) {
      if (method === "GET") {
        const found = await manage.get(name);
        return found ? Response.json(found) : notFound();
      }
      if (method === "PUT") {
        const input = await readObject(request, requestLimit);
        const skill = await manage.updateText(name, { whenToUse: text(input, "whenToUse"), body: text(input, "body"), expectedVersion: version(input, "expectedVersion") }, author);
        return Response.json({ skill });
      }
      if (method === "DELETE") return (await manage.delete(name)) ? new Response(null, { status: 204 }) : notFound();
      return null;
    }
    if (action === "status" && method === "PUT") {
      return Response.json({ skill: await manage.setStatus(name, text(await readObject(request, requestLimit), "status"), author) });
    }
    if (action === "versions" && method === "GET") {
      if (!(await manage.get(name))) return notFound();
      return Response.json({ versions: await manage.versions(name) });
    }
    if (action === "rollback" && method === "POST") {
      const input = await readObject(request, requestLimit);
      return Response.json({ skill: await manage.rollback(name, version(input, "version"), version(input, "expectedVersion"), author) });
    }
    return null;
  }

  return {
    basePath,
    async fetch(request) {
      const segments = pathSegments(new URL(request.url).pathname, basePath);
      if (!segments) return notFound();
      try {
        const user = allowedUser(await options.resolveUser(request));
        if (!user || !(await skills.isAdmin(user, request))) return notFound();
        // Источник проверяется после админа: не-админ всегда получает 404, как будто навыков нет.
        if (!isSafeMethod(request.method) && !allowsOrigin(request)) return Response.json({ error: { kind: "forbidden_origin" } }, { status: 403 });
        return (await route(request, segments, user.id)) ?? notFound();
      } catch (error) {
        return errorToResponse(error, request, logError);
      }
    },
  };
}

function notFound(): Response {
  return Response.json({ error: { kind: "not_found" } }, { status: 404 });
}

function errorToResponse(error: unknown, request: Request, logError: (message: string) => void): Response {
  const fail = (status: number, body: Record<string, unknown>) => Response.json({ error: body }, { status });
  if (error instanceof SkillNotFoundError) return notFound();
  if (error instanceof InvalidSkillError) return fail(400, { kind: "invalid_skill", field: error.field, reason: error.reason, message: error.message });
  if (error instanceof SkillExistsError) return fail(409, { kind: "skill_exists", message: error.message });
  if (error instanceof SkillVersionConflictError) return fail(409, { kind: "version_conflict", currentVersion: error.currentVersion, message: error.message });
  if (error instanceof BadRequestError) return fail(400, { kind: "bad_request", message: error.message });
  if (error instanceof BodyTooLargeError) return fail(413, { kind: "too_large", message: "Request body is too large" });
  logError(`Навыки: сбой на ${request.method} ${new URL(request.url).pathname}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  return fail(500, { kind: "other", message: "Internal error" });
}

function pathSegments(pathname: string, basePath: string): string[] | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  try {
    return pathname
      .slice(basePath.length)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    // Битая кодировка (например, `%E0`): такого адреса нет.
    return null;
  }
}

async function readObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await request.body?.cancel().catch(() => {});
    throw new BodyTooLargeError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readLimitedText(request, limit));
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error;
    throw new BadRequestError("Body is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new BadRequestError("Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Тело потоком: после предела чтение обрывается, поток закрывается. */
async function readLimitedText(request: Request, limit: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function text(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string") throw new BadRequestError(`Field "${field}" must be a string`);
  return value;
}

function optionalText(input: Record<string, unknown>, field: string): string | undefined {
  return input[field] === undefined ? undefined : text(input, field);
}

function version(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new BadRequestError(`Field "${field}" must be a version number`);
  return value;
}
