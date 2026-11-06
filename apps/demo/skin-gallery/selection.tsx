import React from "react";
import { createRoot } from "react-dom/client";
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
const params = new URLSearchParams(location.search);
const theme = params.get("theme") ?? "light";
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");
const style = { padding: 24, background: "var(--yk-bg)", color: "var(--yk-text)", font: "16px/1.6 system-ui" };
createRoot(document.getElementById("root")!).render(<>
  <p id="outside">Текст приложения вне чата</p>
  <main className="oduvanchik-chat" style={style}>
    <h1>Выделение текста · {theme === "dark" ? "тёмная тема" : "светлая тема"}</h1>
    <section style={{ background: "var(--yk-surface)", padding: 16 }}><p id="agent">Ответ агента: выделенный текст должен читаться отчётливо.</p></section>
    <section className="oduvanchik-user"><div data-user-text><div><p id="user">Сообщение пользователя на серой подложке.</p></div></div></section>
    <pre style={{ background: "var(--yk-surface-2)", padding: 16 }}><code id="code">const message = "Выделенный код";</code></pre>
    <section style={{ background: "var(--yk-surface-3)", padding: 16 }}><p id="raised">Дополнительная поверхность чата.</p></section>
    <label className="oduvanchik-field">Поле ввода<textarea id="composer" defaultValue="Текст в поле ввода тоже выделяется контрастно." /></label>
  </main>
  <aside data-agent-chat-oduvanchik style={style}><p id="portal">Текст в портале скина.</p></aside>
</>);
