import { describe, expect, it } from "vitest";
import {
  chooseExit,
  chooseNothing,
  nextQuestionField,
  setKnownValue,
  simulationChoices,
  startSimulation,
  stepBack,
} from "../src/react/editor/flow-simulation";
import { fixtureFlow, HOUR } from "./flow-fixtures";

const NOW = Date.UTC(2026, 9, 13, 9, 0);
const options = { now: NOW, timeZone: "UTC" };

describe("прогон сценария на движке", () => {
  it("начинается со старта, выборы — свои условия, потом общие, с целью от движка", () => {
    const flow = fixtureFlow("sales-review");
    const sim = startSimulation(flow, options);
    expect(sim.run.state).toBe("intro");
    expect(sim.steps).toEqual([{ stateId: "intro", exitId: null, nothing: false }]);
    expect(simulationChoices(flow, sim)).toEqual([
      { exitId: "intro_clear", own: true, target: "block" },
      { exitId: "any_silence", own: false, target: "remind" },
    ]);
  });

  it("условие словами ведёт туда, куда ведёт движок; шаг назад возвращает как было", () => {
    const flow = fixtureFlow("sales-review");
    const start = startSimulation(flow, options);
    const sim = chooseExit(flow, chooseExit(flow, start, "intro_clear"), "block_found");
    expect(sim.run.state).toBe("offer");
    expect(sim.steps.map((step) => [step.stateId, step.exitId])).toEqual([
      ["intro", null],
      ["block", "intro_clear"],
      ["offer", "block_found"],
    ]);
    const back = stepBack(sim);
    expect(back.run.state).toBe("block");
    expect(stepBack(stepBack(back))).toBe(start);
  });

  it("таймер сдвигает часы прогона к сроку; «назад» возвращает в основное состояние", () => {
    const flow = fixtureFlow("sales-review");
    let sim = chooseExit(flow, startSimulation(flow, options), "intro_clear");
    sim = chooseExit(flow, sim, "any_silence");
    expect(sim.run.state).toBe("remind");
    expect(sim.now).toBeGreaterThanOrEqual(NOW + 3 * HOUR);
    sim = chooseExit(flow, sim, "remind_message");
    expect(sim.run.state).toBe("block");
  });

  it("«ничего не сработало» оставляет в состоянии и пишется в путь", () => {
    const flow = fixtureFlow("sales-review");
    const sim = chooseNothing(flow, startSimulation(flow, options));
    expect(sim.run.state).toBe("intro");
    expect(sim.steps.at(-1)).toEqual({ stateId: "intro", exitId: null, nothing: true });
    expect(sim.run.humanMessages).toBe(1);
  });

  it("условие по данным подставляет подходящее значение и переходит", () => {
    const flow = fixtureFlow("shop-support");
    const sim = chooseExit(flow, startSimulation(flow, options), "hello_refund");
    expect(sim.run.state).toBe("refund");
    expect(sim.run.notes.topic).toBe("возврат");

    const lesson = fixtureFlow("sheets-lesson");
    let task = chooseExit(lesson, startSimulation(lesson, options), "explain_got_it");
    task = chooseExit(lesson, task, "task_many_tries");
    expect(task.run.state).toBe("review");
    expect(task.run.notes.tries).toBe(3);
  });

  it("выбор, который движок не применит, отмечен целью null", () => {
    const flow = fixtureFlow("shop-support", (json) => {
      json.states.find((state: { id: string }) => state.id === "hello").exits[0].to = null;
    });
    const choices = simulationChoices(flow, startSimulation(flow, options));
    expect(choices.find((choice) => choice.exitId === "hello_order")!.target).toBeNull();
  });

  it("введённое значение — в карточку или заметки; подходящее условие по данным срабатывает сразу", () => {
    const flow = fixtureFlow("shop-support");
    let sim = setKnownValue(flow, startSimulation(flow, options), "name", "Анна");
    expect(sim.card.name).toEqual({ value: "Анна", updatedAt: sim.now });
    expect(sim.run.state).toBe("hello");
    sim = setKnownValue(flow, sim, "topic", "заказ");
    expect(sim.run.state).toBe("order");
    expect(sim.steps.at(-1)).toEqual({ stateId: "order", exitId: "hello_order", nothing: false });
  });

  it("следующий вопрос о человеке — от движка: сначала «узнать здесь»", () => {
    const flow = fixtureFlow("sales-review");
    const sim = startSimulation(flow, options);
    expect(nextQuestionField(flow, sim)).toBe("course_topic");
    const known = setKnownValue(flow, setKnownValue(flow, sim, "course_topic", "йога"), "sales", "до 10 продаж");
    expect(nextQuestionField(flow, known)).toBe("name");
  });

  it("сценарий без старта не запускается", () => {
    const flow = { ...fixtureFlow("sales-review"), start: null };
    expect(() => startSimulation(flow, options)).toThrow();
  });
});
