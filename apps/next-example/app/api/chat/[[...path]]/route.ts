import { createNextRouteHandlers } from "@ykurilov/agent-chat-server/next";
import { chatHandler } from "@/lib/chat";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } = createNextRouteHandlers(chatHandler);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
