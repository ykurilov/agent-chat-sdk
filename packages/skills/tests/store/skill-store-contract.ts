import { describe, expect, it } from "vitest";
import { SkillExistsError, SkillNotFoundError, SkillVersionConflictError } from "../../src/types";
import type { NewSkill, SkillLoad, SkillStore } from "../../src/types";

/** Две ручки на одну базу: так копии сервера видят одни навыки. У памяти — одно и то же хранилище. */
export interface SharedSkillStores {
  first: SkillStore;
  second: SkillStore;
  close(): Promise<void>;
}

export const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 12, minute)).toISOString();

export function newSkill(overrides: Partial<NewSkill> = {}): NewSkill {
  return { name: "game-dev", whenToUse: "Когда просят сделать игру.", body: "# Игры\nДелай на canvas.", status: "everyone", author: "anna", ...overrides };
}

function load(overrides: Partial<SkillLoad> = {}): SkillLoad {
  return { name: "game-dev", version: 1, chatId: "chat-1", ownerId: "boris", turnId: "answer-1", loadedAt: at(5), ...overrides };
}

/** Общий контракт `SkillStore`: память, SQLite и PostgreSQL ведут себя одинаково. */
export function describeSkillStoreContract(open: () => Promise<SharedSkillStores>): void {
  async function withStores(check: (stores: SharedSkillStores) => Promise<void>): Promise<void> {
    const stores = await open();
    try {
      await check(stores);
    } finally {
      await stores.close();
    }
  }

  describe("договор хранилища навыков", () => {
    it("создание: версия 1, автор и время; вторая ручка видит то же; версия 1 в истории", () =>
      withStores(async ({ first, second }) => {
        const created = await first.create(newSkill(), at(1));
        expect(created).toEqual({
          name: "game-dev",
          whenToUse: "Когда просят сделать игру.",
          body: "# Игры\nДелай на canvas.",
          status: "everyone",
          version: 1,
          createdBy: "anna",
          createdAt: at(1),
          updatedBy: "anna",
          updatedAt: at(1),
        });
        expect(await second.get("game-dev")).toEqual(created);
        expect(await second.listVersions("game-dev")).toEqual([
          { name: "game-dev", version: 1, whenToUse: "Когда просят сделать игру.", body: "# Игры\nДелай на canvas.", author: "anna", createdAt: at(1) },
        ]);
        expect(await first.get("нет-такого")).toBeNull();
      }));

    it("имя занято — SkillExistsError, первый навык не тронут", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        await expect(second.create(newSkill({ body: "другое" }), at(2))).rejects.toBeInstanceOf(SkillExistsError);
        expect((await first.get("game-dev"))?.body).toBe("# Игры\nДелай на canvas.");
      }));

    it("список — по имени, русские и латинские имена вместе", () =>
      withStores(async ({ first }) => {
        for (const name of ["zeta", "договоры", "alpha", "game-dev"]) await first.create(newSkill({ name }), at(1));
        expect((await first.list()).map((skill) => skill.name)).toEqual(["alpha", "game-dev", "zeta", "договоры"]);
      }));

    it("лёгкий список для вставки — те же навыки по имени, без тел", () =>
      withStores(async ({ first, second }) => {
        for (const name of ["zeta", "договоры", "game-dev"]) await first.create(newSkill({ name }), at(1));
        await first.setStatus("zeta", "admins", "boss", at(2));
        const brief = await second.listBrief();
        expect(brief.map((skill) => skill.name)).toEqual(["game-dev", "zeta", "договоры"]);
        expect(brief.every((skill) => !("body" in skill))).toBe(true);
        expect(brief[1]).toEqual({
          name: "zeta",
          whenToUse: "Когда просят сделать игру.",
          status: "admins",
          version: 1,
          createdBy: "anna",
          createdAt: at(1),
          updatedBy: "boss",
          updatedAt: at(2),
        });
      }));

    it("символ NUL не хранится: создание и правка пишут текст без него", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill({ whenToUse: "Иг\u0000ры.", body: "a\u0000b" }), at(1));
        expect(await second.get("game-dev")).toMatchObject({ whenToUse: "Игры.", body: "ab" });
        await first.updateText("game-dev", { whenToUse: "w", body: "c\u0000d", author: "anna", expectedVersion: 1 }, at(2));
        expect((await second.get("game-dev"))?.body).toBe("cd");
        expect((await second.getVersion("game-dev", 2))?.body).toBe("cd");
      }));

    it("правка текста: новая версия, история новыми сверху, создатель прежний", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        const edited = await second.updateText("game-dev", { whenToUse: "Игры и головоломки.", body: "v2", author: "boris", expectedVersion: 1 }, at(2));
        expect(edited).toMatchObject({ version: 2, whenToUse: "Игры и головоломки.", body: "v2", createdBy: "anna", createdAt: at(1), updatedBy: "boris", updatedAt: at(2) });
        expect(await first.get("game-dev")).toEqual(edited);
        expect((await first.listVersions("game-dev")).map((version) => [version.version, version.body, version.author])).toEqual([
          [2, "v2", "boris"],
          [1, "# Игры\nДелай на canvas.", "anna"],
        ]);
        expect(await first.getVersion("game-dev", 1)).toMatchObject({ version: 1, body: "# Игры\nДелай на canvas." });
        expect(await first.getVersion("game-dev", 3)).toBeNull();
      }));

    it("тот же текст — без новой версии и без смены времени правки", () =>
      withStores(async ({ first }) => {
        const created = await first.create(newSkill(), at(1));
        const same = await first.updateText("game-dev", { whenToUse: created.whenToUse, body: created.body, author: "boris", expectedVersion: 1 }, at(2));
        expect(same).toEqual(created);
        expect(await first.listVersions("game-dev")).toHaveLength(1);
      }));

    it("правка со старой версией — SkillVersionConflictError с текущей версией, текст не затёрт", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        await first.updateText("game-dev", { whenToUse: "w", body: "от Анны", author: "anna", expectedVersion: 1 }, at(2));
        const stale = second.updateText("game-dev", { whenToUse: "w", body: "от Бориса", author: "boris", expectedVersion: 1 }, at(3));
        await expect(stale).rejects.toBeInstanceOf(SkillVersionConflictError);
        await expect(stale).rejects.toMatchObject({ currentVersion: 2 });
        expect((await second.get("game-dev"))?.body).toBe("от Анны");
        expect(await second.listVersions("game-dev")).toHaveLength(2);
      }));

    it("одновременные правки одной версии: проходит одна, вторая — конфликт", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        const results = await Promise.allSettled([
          first.updateText("game-dev", { whenToUse: "w", body: "A", author: "anna", expectedVersion: 1 }, at(2)),
          second.updateText("game-dev", { whenToUse: "w", body: "B", author: "boris", expectedVersion: 1 }, at(2)),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(SkillVersionConflictError);
        expect(await first.listVersions("game-dev")).toHaveLength(2);
      }));

    it("правка и статус несуществующего — SkillNotFoundError", () =>
      withStores(async ({ first }) => {
        await expect(first.updateText("нет", { whenToUse: "w", body: "b", author: "anna", expectedVersion: 1 }, at(1))).rejects.toBeInstanceOf(SkillNotFoundError);
        await expect(first.setStatus("нет", "off", "anna", at(1))).rejects.toBeInstanceOf(SkillNotFoundError);
      }));

    it("статус меняется без новой версии; автор и время правки — новые", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        const changed = await second.setStatus("game-dev", "admins", "boris", at(4));
        expect(changed).toMatchObject({ status: "admins", version: 1, updatedBy: "boris", updatedAt: at(4) });
        expect((await first.get("game-dev"))?.status).toBe("admins");
        expect(await first.listVersions("game-dev")).toHaveLength(1);
      }));

    it("удаление: навык, версии и учёт; повтор — false", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        await first.create(newSkill({ name: "other" }), at(1));
        await first.recordLoad(load());
        await first.recordLoad(load({ name: "other" }));
        expect(await second.delete("game-dev")).toBe(true);
        expect(await first.get("game-dev")).toBeNull();
        expect(await first.listVersions("game-dev")).toEqual([]);
        expect(await first.loadStats("game-dev", 10)).toEqual({ total: 0, recent: [] });
        expect(await first.loadCounts()).toEqual({ other: 1 });
        expect(await second.delete("game-dev")).toBe(false);
        // Новый навык с тем же именем начинает с версии 1 и чистого учёта.
        expect((await first.create(newSkill(), at(6))).version).toBe(1);
      }));

    it("учёт загрузок: всего, последние новыми сверху в пределе, счётчик по навыкам", () =>
      withStores(async ({ first, second }) => {
        await first.create(newSkill(), at(1));
        await first.create(newSkill({ name: "other" }), at(1));
        for (let minute = 10; minute < 15; minute += 1) {
          await first.recordLoad(load({ chatId: `chat-${minute}`, turnId: `answer-${minute}`, loadedAt: at(minute), version: minute < 12 ? 1 : 2 }));
        }
        await second.recordLoad(load({ name: "other", loadedAt: at(20) }));
        const stats = await second.loadStats("game-dev", 3);
        expect(stats.total).toBe(5);
        expect(stats.recent).toEqual([
          load({ chatId: "chat-14", turnId: "answer-14", loadedAt: at(14), version: 2 }),
          load({ chatId: "chat-13", turnId: "answer-13", loadedAt: at(13), version: 2 }),
          load({ chatId: "chat-12", turnId: "answer-12", loadedAt: at(12), version: 2 }),
        ]);
        expect(await first.loadCounts()).toEqual({ "game-dev": 5, other: 1 });
      }));
  });
}
