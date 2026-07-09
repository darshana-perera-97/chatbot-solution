export const CHAT_SESSION_POLL_MS = 4000;
export const CHAT_SESSION_POLL_FAST_MS = 2000;
export const CHATS_OPERATOR_POLL_MS = 2000;
export const CHATS_OPERATOR_POLL_FAST_MS = 1500;

export function normalizeSessionMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter((line) => line && (line.role === "assistant" || line.role === "user" || line.role === "agent"))
    .map((line) => ({
      role: line.role,
      content: typeof line.content === "string" ? line.content : "",
      ...(Array.isArray(line.attachments) && line.attachments.length > 0
        ? { attachments: line.attachments }
        : {}),
    }))
    .filter((line) => line.content.trim().length > 0);
}
