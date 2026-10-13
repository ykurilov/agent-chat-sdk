import { describe, expect, it } from "vitest";
import { assertSafeToWipe } from "./support/wipe-guard";

describe("защита от стирания чужой базы", () => {
  it("пускает базу с «test» в имени", () => {
    expect(() => assertSafeToWipe("postgres://u@localhost:5432/agent_chat_test", {})).not.toThrow();
    expect(() => assertSafeToWipe("postgres://u:p@h/MyTestDb?sslmode=require", {})).not.toThrow();
  });

  it("отказывает базе без «test» и не называет пароль", () => {
    const attempt = () => assertSafeToWipe("postgres://anna:секрет@prod-host:5432/shop", {});
    expect(attempt).toThrow(/не содержит «test»/);
    expect(attempt).toThrow(/shop/);
    expect(attempt).not.toThrow(/секрет/);
  });

  it("отказывает, если адрес не разобрать", () => {
    expect(() => assertSafeToWipe("не-адрес", {})).toThrow(/не содержит «test»/);
  });

  it("явное подтверждение снимает отказ", () => {
    expect(() => assertSafeToWipe("postgres://u@h/shop", { AGENT_CHAT_TEST_POSTGRES_WIPE: "yes" })).not.toThrow();
    expect(() => assertSafeToWipe("postgres://u@h/shop", { AGENT_CHAT_TEST_POSTGRES_WIPE: "1" })).toThrow();
  });
});
