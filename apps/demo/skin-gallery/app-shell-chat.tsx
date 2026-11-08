import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog, ThemeSettings } from "@ykurilov/ds-react";
import { AppShellChatWorkspace } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import "@ykurilov/ds-tokens/tokens.css";
import "@ykurilov/ds-react/styles.css";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.body.style.margin = "0";
function Fixture() {
  const [settings, setSettings] = useState(false);
  return <div style={{ height: "100dvh" }}><AppShellChatWorkspace api="/app-shell-fixture" initialChatId="c1" historyVisibleCount={3}
    composerOptions={{ variant: "compact" }} shell={{ brand: { label: "Агент" }, navigation: [], storageKey: "shell-fixture",
      account: { name: "Тестовый пользователь", email: "test@example.invalid", menu: [{ label: "Настройки", onSelect: () => setSettings(true) }] },
      onSettings: () => setSettings(true) }} />
    <Dialog open={settings} onClose={() => setSettings(false)} title="Настройки"><ThemeSettings /></Dialog>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
