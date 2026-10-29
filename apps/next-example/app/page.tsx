import { chatHandler } from "../lib/chat";
import { ChatPage } from "./chat-page";

export default function Page() {
  return <main data-server-handler={typeof chatHandler.fetch === "function"}><ChatPage /></main>;
}
