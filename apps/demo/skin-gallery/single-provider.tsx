import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@tandem/ui";
import { OduvanchikComposer } from "@ykurilov/agent-chat-skin-oduvanchik";
import type { ModelChoice } from "@ykurilov/agent-chat-core";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const models = Array.from({ length: 11 }, (_, i) => ({ id: `model-${i}`, name: `Модель ${i + 1}`, group: "Все модели через WildWest", acceptsImages: i % 2 === 0 }));
function Fixture() {
  const [current, setCurrent] = useState<ModelChoice>({ modelId: "model-0", providerId: "wildwest" });
  return <TooltipProvider><main className="oduvanchik-chat" data-current={current.providerId} style={{ background: "var(--yk-bg)", color: "var(--yk-text)", minHeight: "100dvh", padding: 20, display: "flex", alignItems: "flex-end" }}>
    <OduvanchikComposer value="" onValueChange={() => {}} onSubmit={() => {}} canSubmit={false} busy={false} onStop={() => {}} options={{ variant: "extended" }} modelChoice={{ current, onChange: setCurrent, providers: [{ id: "wildwest", name: "WildWest", models }, ...(params.has("multi") ? [{ id: "other", name: "Другой", models: [models[0]!] }] : [])], reasoning: "off", reasoningLevels: [], onReasoningChange: () => {} }} />
  </main></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
