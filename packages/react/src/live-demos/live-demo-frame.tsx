import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { LiveDemoColors } from "../skin-contract";
import { LIVE_DEMO_SANDBOX, demoHeightOf, demoLeftPage, liveDemoDocument } from "./live-demo-document";

/** Высота рамки, пока документ не сообщил свою. */
const INITIAL_HEIGHT = 160;

/** Две трети высоты окна: выше рамка не растёт, дальше прокрутка внутри. */
function useTwoThirdsOfScreen(): number {
  const [limit, setLimit] = useState(() => Math.round((window.innerHeight * 2) / 3));
  useEffect(() => {
    const update = () => setLimit(Math.round((window.innerHeight * 2) / 3));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return limit;
}

export interface LiveDemoFrameProps {
  source: string;
  colors: LiveDemoColors;
  /** Подпись рамки для диктора. */
  title: string;
  /** Код ушёл со своей страницы (сообщение промежуточного документа или вторая загрузка рамки). */
  onLeftPage: () => void;
}

/**
 * Рамка живой демонстрации: изолированная песочница, документ через `srcdoc`, ширина во весь ответ, высота — из
 * сообщения своей рамки. Новые цвета — новый документ: демонстрация перерисовывается.
 */
export const LiveDemoFrame = memo(function LiveDemoFrame({ source, colors, title, onLeftPage }: LiveDemoFrameProps) {
  const srcDoc = useMemo(() => liveDemoDocument(source, colors), [source, colors]);
  return <Frame key={srcDoc} srcDoc={srcDoc} dark={colors.dark} title={title} onLeftPage={onLeftPage} />;
});

function Frame({ srcDoc, dark, title, onLeftPage }: { srcDoc: string; dark: boolean; title: string; onLeftPage: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const limit = useTwoThirdsOfScreen();
  const leftPage = useRef(onLeftPage);
  leftPage.current = onLeftPage;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frame.current?.contentWindow;
      if (demoLeftPage(event, frameWindow)) return leftPage.current();
      const reported = demoHeightOf(event, frameWindow);
      if (reported !== null) setHeight(reported);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox={LIVE_DEMO_SANDBOX}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      data-live-demo-frame=""
      onLoad={() => {
        if (++loads.current > 1) leftPage.current();
      }}
      // Схема цветов рамки та же, что у документа: иначе браузер подложит под прозрачный документ непрозрачный фон.
      style={{ display: "block", width: "100%", height: `${Math.min(height, limit)}px`, border: 0, colorScheme: dark ? "dark" : "light" }}
    />
  );
}
