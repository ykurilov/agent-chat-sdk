import { parentPort, workerData } from "node:worker_threads";

/** Копия сервера: открывает хранилище на общем файле одновременно с остальными (ждёт общий старт). */
const { modulePath, exportName, args, start } = workerData as { modulePath: string; exportName: string; args: unknown[]; start: SharedArrayBuffer };
const open = (await import(modulePath))[exportName] as (...args: unknown[]) => { close?: () => unknown };
parentPort!.postMessage("ready");
Atomics.wait(new Int32Array(start), 0, 0);
try {
  const store = open(...args);
  await store.close?.();
  parentPort!.postMessage({ ok: true });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: String(error) });
}
