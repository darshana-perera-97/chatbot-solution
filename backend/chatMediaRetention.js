const fs = require("fs");
const path = require("path");

/** Chats and attachment binaries are kept for at least 14 days. */
const CHAT_RETENTION_DAYS = 14;
const CHAT_MEDIA_RETENTION_MS = CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CHAT_MEDIA_PURGE_INTERVAL_MS = 60 * 60 * 1000;
/** 0 = keep every conversation; set via CHAT_SESSION_MAX_COUNT env to cap if needed. */
const CHAT_SESSION_MAX_COUNT = Math.max(
  0,
  Number.parseInt(process.env.CHAT_SESSION_MAX_COUNT || "0", 10) || 0
);

function isAttachmentExpired(referenceMs, nowMs = Date.now()) {
  if (!Number.isFinite(referenceMs) || referenceMs <= 0) return false;
  return nowMs - referenceMs > CHAT_MEDIA_RETENTION_MS;
}

function expireAttachmentMetadata(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const productTitle =
    typeof attachment.productTitle === "string" && attachment.productTitle.trim()
      ? attachment.productTitle.trim().slice(0, 200)
      : "";

  if (attachment.kind === "image") {
    const row = {
      kind: "image",
      imageName:
        typeof attachment.imageName === "string" && attachment.imageName.trim()
          ? attachment.imageName.trim().slice(0, 180)
          : "Image",
      expired: true,
    };
    if (productTitle) row.productTitle = productTitle;
    return row;
  }
  if (attachment.kind === "video") {
    return {
      kind: "video",
      videoName:
        typeof attachment.videoName === "string" && attachment.videoName.trim()
          ? attachment.videoName.trim().slice(0, 180)
          : "Video",
      expired: true,
    };
  }
  if (attachment.kind === "pdf") {
    const row = {
      kind: "pdf",
      pdfName:
        typeof attachment.pdfName === "string" && attachment.pdfName.trim()
          ? attachment.pdfName.trim().slice(0, 180)
          : "document.pdf",
      expired: true,
    };
    if (productTitle) row.productTitle = productTitle;
    return row;
  }
  if (attachment.kind === "file") {
    return {
      kind: "file",
      fileName:
        typeof attachment.fileName === "string" && attachment.fileName.trim()
          ? attachment.fileName.trim().slice(0, 180)
          : "File",
      mimeType:
        typeof attachment.mimeType === "string" && attachment.mimeType.trim()
          ? attachment.mimeType.trim().slice(0, 120)
          : "application/octet-stream",
      expired: true,
    };
  }
  return null;
}

function applyMediaRetentionToAttachment(attachment, referenceMs, nowMs = Date.now()) {
  if (!attachment || typeof attachment !== "object") return attachment;
  if (attachment.expired === true) return attachment;
  if (!isAttachmentExpired(referenceMs, nowMs)) return attachment;
  return expireAttachmentMetadata(attachment) || attachment;
}

function applyMediaRetentionToMessage(msg, nowMs = Date.now(), fallbackMs = nowMs) {
  if (!msg || typeof msg !== "object") return msg;
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  if (!attachments.length) return msg;

  let referenceMs = fallbackMs;
  if (typeof msg.createdAt === "string" && msg.createdAt.trim()) {
    const parsed = Date.parse(msg.createdAt.trim());
    if (Number.isFinite(parsed)) referenceMs = parsed;
  }

  const nextAttachments = attachments.map((attachment) =>
    applyMediaRetentionToAttachment(attachment, referenceMs, nowMs)
  );

  const changed =
    nextAttachments.length !== attachments.length ||
    nextAttachments.some((entry, index) => entry !== attachments[index]);

  if (!changed) return msg;
  return { ...msg, attachments: nextAttachments };
}

function applyMediaRetentionToMessages(messages, nowMs = Date.now(), sessionFallbackMs = nowMs) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  let changed = false;
  const next = messages.map((msg) => {
    const updated = applyMediaRetentionToMessage(msg, nowMs, sessionFallbackMs);
    if (updated !== msg) changed = true;
    return updated;
  });
  return changed ? next : messages;
}

function sessionsMediaChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function applyMediaRetentionToSessions(sessions, nowMs = Date.now()) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return { sessions: sessions || [], changed: false };
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    const sessionFallbackMs = Date.parse(session?.updatedAt || session?.createdAt || "") || nowMs;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const nextMessages = applyMediaRetentionToMessages(messages, nowMs, sessionFallbackMs);
    if (nextMessages !== messages) {
      changed = true;
      return { ...session, messages: nextMessages };
    }
    return session;
  });

  return { sessions: changed ? nextSessions : sessions, changed };
}

function listChatStoreUserIds(dataDir, readAccounts) {
  const ids = new Set();
  const accounts = typeof readAccounts === "function" ? readAccounts() : [];
  for (const account of accounts) {
    const id = String(account?.id || "").trim();
    if (id) ids.add(id);
  }

  if (fs.existsSync(dataDir)) {
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const chatsPath = path.join(dataDir, entry.name, "chats.json");
      if (fs.existsSync(chatsPath)) ids.add(entry.name);
    }
  }

  return [...ids];
}

function purgeExpiredChatMediaForUser(userId, deps, nowMs = Date.now()) {
  const { readChatsStore, writeChatsStore } = deps;
  if (!userId || typeof readChatsStore !== "function" || typeof writeChatsStore !== "function") {
    return { purged: false, userId };
  }

  const store = readChatsStore(userId);
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const { sessions: nextSessions, changed } = applyMediaRetentionToSessions(sessions, nowMs);
  if (!changed) return { purged: false, userId };

  writeChatsStore({ sessions: nextSessions }, userId);
  return { purged: true, userId };
}

function purgeAllExpiredChatMedia(deps, nowMs = Date.now()) {
  const { dataDir, readAccounts, readChatsStore, writeChatsStore, legacyChatsPath } = deps;
  const userIds = listChatStoreUserIds(dataDir, readAccounts);
  const results = [];

  for (const userId of userIds) {
    results.push(purgeExpiredChatMediaForUser(userId, { readChatsStore, writeChatsStore }, nowMs));
  }

  if (legacyChatsPath && fs.existsSync(legacyChatsPath)) {
    try {
      const raw = fs.readFileSync(legacyChatsPath, "utf8");
      const parsed = JSON.parse(raw || "{}");
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const { sessions: nextSessions, changed } = applyMediaRetentionToSessions(sessions, nowMs);
      if (changed) {
        fs.writeFileSync(
          legacyChatsPath,
          JSON.stringify({ sessions: nextSessions }, null, 2),
          "utf8"
        );
        results.push({ purged: true, userId: "__legacy__" });
      }
    } catch {
      /* ignore legacy store errors */
    }
  }

  const purgedCount = results.filter((entry) => entry.purged).length;
  return { purgedCount, results };
}

/**
 * Optionally cap stored conversations. Default keeps every session so the Chats page
 * can show full history; attachment binaries still expire via applyMediaRetention*.
 */
function trimChatSessions(
  sessions,
  maxCount = CHAT_SESSION_MAX_COUNT,
  retentionMs = CHAT_MEDIA_RETENTION_MS,
  nowMs = Date.now()
) {
  if (!Array.isArray(sessions) || !sessions.length) return sessions || [];
  if (!maxCount || maxCount <= 0) return sessions;

  const retentionCutoff = nowMs - retentionMs;
  const withinRetention = [];
  const outsideRetention = [];

  for (const session of sessions) {
    const refMs = Date.parse(session?.updatedAt || session?.createdAt || "") || 0;
    if (refMs >= retentionCutoff) withinRetention.push(session);
    else outsideRetention.push(session);
  }

  outsideRetention.sort(
    (a, b) =>
      (Date.parse(b?.updatedAt || b?.createdAt || "") || 0) -
      (Date.parse(a?.updatedAt || a?.createdAt || "") || 0)
  );

  const slotsForOlder = Math.max(0, maxCount - withinRetention.length);
  const keptOlder = outsideRetention.slice(0, slotsForOlder);
  const keptKeys = new Set(
    [...withinRetention, ...keptOlder].map((session) =>
      String(session?.conversationId || session?.id || "")
    )
  );

  return sessions.filter((session) =>
    keptKeys.has(String(session?.conversationId || session?.id || ""))
  );
}

function scheduleChatMediaPurge(deps) {
  const run = () => {
    try {
      const { purgedCount } = purgeAllExpiredChatMedia(deps);
      if (purgedCount > 0) {
        console.log(`[chat-media] purged expired media from ${purgedCount} chat store(s)`);
      }
    } catch (e) {
      console.warn(
        "[chat-media] purge failed:",
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  run();
  return setInterval(run, CHAT_MEDIA_PURGE_INTERVAL_MS);
}

module.exports = {
  CHAT_RETENTION_DAYS,
  CHAT_MEDIA_RETENTION_MS,
  CHAT_MEDIA_PURGE_INTERVAL_MS,
  CHAT_SESSION_MAX_COUNT,
  expireAttachmentMetadata,
  applyMediaRetentionToAttachment,
  applyMediaRetentionToMessage,
  applyMediaRetentionToMessages,
  applyMediaRetentionToSessions,
  trimChatSessions,
  purgeAllExpiredChatMedia,
  scheduleChatMediaPurge,
};
