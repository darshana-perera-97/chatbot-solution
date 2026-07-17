export const CHAT_SESSION_POLL_MS = 4000;
export const CHAT_SESSION_POLL_FAST_MS = 2000;
export const CHATS_OPERATOR_POLL_MS = 2000;
export const CHATS_OPERATOR_POLL_FAST_MS = 1500;
/** WhatsApp status on Chats — less frequent than session list polls. */
export const CHATS_WA_STATUS_POLL_MS = 8000;
/** Active thread refresh while a conversation is open. */
export const CHATS_ACTIVE_THREAD_POLL_MS = 1500;

/** Split message text into lines so chat bubbles can preserve line breaks. */
export function splitMessageLines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
}

export function normalizeMessageCreatedAt(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/** Today, 3:45 PM | Yesterday, 3:45 PM | Jul 12, 2026, 3:45 PM */
export function formatMessageTimestamp(iso) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMsgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday - startOfMsgDay) / (24 * 60 * 60 * 1000));
  const timeLabel = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 0) return `Today, ${timeLabel}`;
  if (dayDiff === 1) return `Yesterday, ${timeLabel}`;
  const dateLabel = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${dateLabel}, ${timeLabel}`;
}

export function normalizeSessionMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter(
      (line) =>
        line &&
        (line.role === "assistant" ||
          line.role === "user" ||
          line.role === "agent" ||
          line.role === "main_account")
    )
    .map((line) => {
      const createdAt = normalizeMessageCreatedAt(line.createdAt);
      return {
        role: line.role,
        content: typeof line.content === "string" ? line.content : "",
        ...(createdAt ? { createdAt } : {}),
        ...(Array.isArray(line.attachments) && line.attachments.length > 0
          ? { attachments: line.attachments }
          : {}),
      };
    })
    .filter((line) => line.content.trim().length > 0 || (Array.isArray(line.attachments) && line.attachments.length > 0));
}
