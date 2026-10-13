import { useCallback, useEffect, useRef, useState } from "react";

type DemoJson<Result> = Result | null | "not_found" | "failed";

/**
 * Загрузка JSON с демо-сервера: `null`, пока идёт первый запрос, и `"not_found"`/`"failed"`, если не вышло.
 * `reload` читает данные заново без перезагрузки страницы: прежние данные остаются на экране, пока идёт запрос.
 */
export function useDemoJson<Result>(url: string): [DemoJson<Result>, () => void] {
  const [result, setResult] = useState<DemoJson<Result>>(null);
  const [reloads, setReloads] = useState(0);
  const loadedUrl = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    if (loadedUrl.current !== url) setResult(null);
    loadedUrl.current = url;
    fetch(url)
      .then(async (response) => (response.status === 404 ? "not_found" : response.ok ? ((await response.json()) as Result) : "failed"))
      .catch(() => "failed" as const)
      .then((value) => current && setResult(value));
    return () => {
      current = false;
    };
  }, [url, reloads]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return [result, reload];
}
