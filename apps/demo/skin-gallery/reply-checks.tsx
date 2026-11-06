import React from "react";
import { createRoot } from "react-dom/client";
import { useAgentChat } from "@ykurilov/agent-chat-react";
function App() {
  const chat = useAgentChat({ api: "/reply-fixture", chatId: "one" });
  return <main><textarea aria-label="Сообщение" value={chat.value} onChange={(event) => chat.setValue(event.target.value)} />
    <button disabled={!chat.loaded} onClick={() => chat.submit()}>Отправить</button>
    <div data-testid="status">{chat.messages.at(-1)?.metadata?.status}</div>
    {chat.messages.filter((message) => message.role === "assistant").map((message) => <article key={message.id}>
      {message.parts.map((part, index) => part.type === "text" ? <p key={index}>{part.text}</p> : part.type.startsWith("tool-") ? <div data-testid="tool" key={index}>{JSON.stringify(part)}</div> : null)}
    </article>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
