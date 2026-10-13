/** Метки одного хода «конец фразы → первый звук» в порядке следования. */
export type LatencyPoint = "phraseEndAt" | "firstTextAt" | "firstSentenceAt" | "speechStartedAt" | "firstSampleAt";

/** Звенья цепочки: сколько времени съело каждое. */
export type LatencyLeg = "model" | "sentence" | "speech" | "delivery";

export interface LatencyReport {
  marks: Partial<Record<LatencyPoint, number>>;
  /** Звено есть, только если обе его метки поставлены. */
  legs: Partial<Record<LatencyLeg, number>>;
  totalMs: number;
}

export interface LatencySummary {
  count: number;
  medianMs: number | null;
  p90Ms: number | null;
  legsMedianMs: Partial<Record<LatencyLeg, number>>;
}

export interface LatencyMeter {
  /** Метка ставится один раз за ход. `phraseEndAt` начинает новый ход; без начатого хода метки не нужны. */
  mark(point: LatencyPoint, at?: number): void;
  /** Закрыть ход. Есть отчёт, если дошло до первого звука. */
  finishTurn(): LatencyReport | null;
  summary(): LatencySummary;
}

export interface LatencyMeterOptions {
  now?: () => number;
  /** Сколько последних ходов помнить. По умолчанию 200. */
  keepTurns?: number;
}

const DEFAULT_KEEP_TURNS = 200;

const LEGS: Array<[LatencyLeg, LatencyPoint, LatencyPoint]> = [
  ["model", "phraseEndAt", "firstTextAt"],
  ["sentence", "firstTextAt", "firstSentenceAt"],
  ["speech", "firstSentenceAt", "speechStartedAt"],
  ["delivery", "speechStartedAt", "firstSampleAt"],
];

export function createLatencyMeter(options: LatencyMeterOptions = {}): LatencyMeter {
  const now = options.now ?? (() => performance.now());
  const keepTurns = options.keepTurns ?? DEFAULT_KEEP_TURNS;
  let marks: Partial<Record<LatencyPoint, number>> | null = null;
  const reports: LatencyReport[] = [];

  return {
    mark(point, at = now()) {
      if (point === "phraseEndAt") marks = {};
      if (!marks || marks[point] !== undefined) return;
      marks[point] = at;
    },
    finishTurn() {
      const finished = marks;
      marks = null;
      if (finished?.phraseEndAt === undefined || finished.firstSampleAt === undefined) return null;
      const legs: LatencyReport["legs"] = {};
      for (const [leg, from, to] of LEGS) {
        const start = finished[from];
        const end = finished[to];
        if (start !== undefined && end !== undefined) legs[leg] = end - start;
      }
      const report: LatencyReport = { marks: finished, legs, totalMs: finished.firstSampleAt - finished.phraseEndAt };
      reports.push(report);
      if (reports.length > keepTurns) reports.splice(0, reports.length - keepTurns);
      return report;
    },
    summary() {
      const totals = reports.map((report) => report.totalMs);
      const legsMedianMs: LatencySummary["legsMedianMs"] = {};
      for (const [leg] of LEGS) {
        const values = reports.flatMap((report) => (report.legs[leg] === undefined ? [] : [report.legs[leg]]));
        if (values.length > 0) legsMedianMs[leg] = median(values);
      }
      return {
        count: reports.length,
        medianMs: totals.length > 0 ? median(totals) : null,
        p90Ms: totals.length > 0 ? percentile(totals, 0.9) : null,
        legsMedianMs,
      };
    },
  };
}

const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

function median(values: number[]): number {
  const sorted = ascending(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Метод ближайшего ранга: девяностый процентиль из десяти — девятое по возрастанию. */
function percentile(values: number[], share: number): number {
  const sorted = ascending(values);
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]!;
}
