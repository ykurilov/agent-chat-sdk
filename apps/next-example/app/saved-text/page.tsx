import { OduvanchikAgentText } from "@ykurilov/agent-chat-skin-oduvanchik/text";
import "@ykurilov/agent-chat-skin-oduvanchik/text/styles.css";

/** Pure Server Component: saved text needs neither a chat nor a client provider. */
export default function SavedTextPage() {
  return <main data-static-message="ready"><OduvanchikAgentText markdown={"## Saved Markdown SSR\n\n**Rendered without chat hooks**\n\n- [x] GFM\n\n![External](https://example.invalid/pixel)"} /></main>;
}
