// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { englishTandemLabels, russianTandemLabels, TandemLabelsProvider, useTandemLabels } from "@tandem/ui";
import { ChatLabelsProvider, englishLabels, russianLabels } from "@ykurilov/agent-chat-react";
import type { ChatLabels } from "@ykurilov/agent-chat-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TandemSkinLabels } from "../src/tandem-labels";

afterEach(cleanup);

const seen: unknown[] = [];

function Probe() {
  const composer = useTandemLabels("composer");
  const markdown = useTandemLabels("markdown");
  seen.push(composer);
  return (
    <p data-testid="probe">
      {[composer.placeholder, composer.message, composer.send, composer.stop, composer.attach, markdown.table, markdown.copyCode].join("|")}
    </p>
  );
}

const probeWith = (labels: ChatLabels, outer?: ReactNode) =>
  render(
    <ChatLabelsProvider labels={labels}>
      {outer ?? (
        <TandemSkinLabels>
          <Probe />
        </TandemSkinLabels>
      )}
    </ChatLabelsProvider>,
  );

describe("скин передаёт Тандему надписи из словаря SDK", () => {
  it("englishLabels — английский словарь Тандема, надписи SDK поверх", () => {
    probeWith(englishLabels);
    expect(screen.getByTestId("probe").textContent).toBe(
      [englishLabels.composerPlaceholder, englishLabels.composerLabel, englishLabels.send, englishLabels.stop, englishTandemLabels.composer.attach, englishTandemLabels.markdown.table, englishLabels.copyCode].join("|"),
    );
  });

  it("русский словарь — русский словарь Тандема; своя надпись приложения в SDK видна и в Тандеме", () => {
    probeWith({ ...russianLabels, composerPlaceholder: "Спросите агента" });
    expect(screen.getByTestId("probe").textContent).toBe(
      ["Спросите агента", russianLabels.composerLabel, russianLabels.send, russianLabels.stop, russianTandemLabels.composer.attach, russianTandemLabels.markdown.table, russianLabels.copyCode].join("|"),
    );
  });

  it("другой язык (`locale` не ru и не en) — словарь Тандема берётся у провайдера приложения", () => {
    const german = { ...englishLabels, locale: "de", composerPlaceholder: "Nachricht schreiben" };
    probeWith(
      german,
      <TandemLabelsProvider labels={{ composer: { attach: "Anhängen" }, markdown: { table: "Tabelle" } }}>
        <TandemSkinLabels>
          <Probe />
        </TandemSkinLabels>
      </TandemLabelsProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe(
      ["Nachricht schreiben", englishLabels.composerLabel, englishLabels.send, englishLabels.stop, "Anhängen", "Tabelle", englishLabels.copyCode].join("|"),
    );
  });

  it("словарь Тандема стабилен: перерисовка с тем же словарём SDK не даёт новых надписей", () => {
    let rerender: () => void = () => {};
    function Host() {
      const [, setTick] = useState(0);
      rerender = () => setTick((tick) => tick + 1);
      return (
        <ChatLabelsProvider labels={englishLabels}>
          <TandemSkinLabels>
            <Probe />
          </TandemSkinLabels>
        </ChatLabelsProvider>
      );
    }
    seen.length = 0;
    render(<Host />);
    act(() => rerender());
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(seen[0]);
  });
});
