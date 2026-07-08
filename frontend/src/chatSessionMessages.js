export const CHAT_SESSION_POLL_MS = 4000;

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
