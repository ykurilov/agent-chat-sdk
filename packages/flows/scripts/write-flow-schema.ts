// Пересобирает agent-flow.schema.json из zod-схемы: pnpm --filter @ykurilov/agent-chat-flows schema:write
import { writeFileSync } from "node:fs";
import { flowJsonSchema } from "../src/format/flow-json-schema";

writeFileSync(new URL("../agent-flow.schema.json", import.meta.url), `${JSON.stringify(flowJsonSchema(), null, 2)}\n`);
