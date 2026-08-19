import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, FileText, MessageSquareDot, MoreVertical, Pencil, Search, Send, Trash2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { AssistantAttachments } from "../components/AssistantAttachments";
import { MessageText } from "../components/MessageText";
import {
  CHATS_ACTIVE_THREAD_POLL_MS,
  CHATS_OPERATOR_POLL_MS,
  CHATS_WA_CONNECTED_POLL_MS,
  CHATS_WA_STATUS_POLL_MS,
  formatMessageTimestamp,
} from "../chatSessionMessages";
import {
  NOT_ALLOCATED_BADGE_LABEL,
  badgePillStyle,
  findConversationBadge,
  normalizeConversationBadges,
} from "../conversationBadges";

function formatConversationTime(iso) {
  const date = Date.parse(String(iso || ""));
  if (!Number.isFinite(date)) return "";
  const deltaMs = Date.now() - date;
  if (deltaMs < 60 * 1000) return "Now";
  if (deltaMs < 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 1000))}m`;
  if (deltaMs < 24 * 60 * 60 * 1000) return `${Math.floor(deltaMs / (60 * 60 * 1000))}h`;
  return new Date(date).toLocaleDateString();
}

/** Maps API session to a single human-readable source line: Test Bot | Web | WhatsApp (account). */
function formatSessionSourceLabel(session) {
  const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
  const src = raw === "web" || raw === "whatsapp" || raw === "test_bot" ? raw : "test_bot";
  const acc =
    typeof session?.channelAccountName === "string" ? session.channelAccountName.trim() : "";
  if (src === "web") return "Web";
  if (src === "whatsapp") return acc ? `WhatsApp (${acc})` : "WhatsApp";
  return "Test Bot";
}

function sessionSourceStyleKey(session) {
  const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
  if (raw === "web") return "web";
  if (raw === "whatsapp") return "whatsapp";
  return "test_bot";
}

function normalizeChatSource(session) {
  const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
  if (raw === "web") return "web";
  if (raw === "whatsapp") return "whatsapp";
  return "test_bot";
}

function getAccountFilterKey(session) {
  if (normalizeChatSource(session) !== "whatsapp") return null;
  const accountId =
    typeof session?.whatsappAccountId === "string" ? session.whatsappAccountId.trim() : "1";
  return `whatsapp:${accountId || "1"}`;
}

/** Hide WhatsApp group / channel / status threads — inbox is personal chats only. */
function isWhatsAppGroupSession(session) {
  if (normalizeChatSource(session) !== "whatsapp") return false;
  const chatId = typeof session?.whatsappChatId === "string" ? session.whatsappChatId.trim() : "";
  const chatLower = chatId.toLowerCase();
  if (
    chatLower.endsWith("@g.us") ||
    chatLower.endsWith("@broadcast") ||
    chatLower.endsWith("@newsletter") ||
    chatLower === "status@broadcast"
  ) {
    return true;
  }
  const conversationId =
    typeof session?.conversationId === "string" ? session.conversationId.trim() : "";
  const convLower = conversationId.toLowerCase();
  return (
    convLower.endsWith("_g_us") ||
    convLower.endsWith("_broadcast") ||
    convLower.endsWith("_newsletter") ||
    convLower.includes("status_broadcast")
  );
}

function whatsAppAccountLabel(account) {
  if (!account) return "";
  const parts = [account.pushname, account.phone].filter(Boolean);
  return parts.length ? parts.join(" · ") : account.label || `Account ${account.accountId}`;
}

/** Stable id for the latest customer message — used so the sidebar badge does not reappear after it was seen. */
function liveAgentMessageFingerprint(session, lastRole) {
  const conversationId =
    typeof session?.conversationId === "string" ? session.conversationId.trim() : "";
  if (!conversationId) return "";
  const messageCount = Number(session?.messageCount) || 0;
  const role = String(lastRole || "").trim();
  return `${conversationId}|${messageCount}|${role}`;
}

const SOURCE_BADGE_CLASS = {
  test_bot: "bg-violet-100 text-violet-800 ring-1 ring-violet-200/80",
  web: "bg-sky-100 text-sky-800 ring-1 ring-sky-200/80",
  whatsapp: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80",
};

function ConversationBadgeButton({ badge, onClick, className = "" }) {
  const allocated = Boolean(badge?.id);
  const label = allocated ? badge.label : NOT_ALLOCATED_BADGE_LABEL;
  const style = badgePillStyle(badge?.color, { allocated });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition hover:opacity-90 ${className}`}
      style={style}
      title="Assign badge"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function ConversationDocumentIndicator({ documentCount, documentLabel, className = "" }) {
  if (!documentCount) return null;
  const countLabel =
    documentCount > 1 ? `${documentCount} documents` : documentLabel || "Document";
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md border border-amber-200/90 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ${className}`}
      title={documentLabel || countLabel}
    >
      <FileText size={11} strokeWidth={2.25} className="shrink-0" aria-hidden />
      <span className="truncate">{countLabel}</span>
    </span>
  );
}

function BadgePickerModal({ open, badges, currentBadgeId, saving, onClose, onSelect }) {
  if (!open) return null;
  const selectedId = String(currentBadgeId || "").trim();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-picker-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[#E9D5FF] bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="badge-picker-title" className="text-lg font-bold text-slate-900">
          Assign badge
        </h2>
        <p className="mt-1 text-sm text-slate-500">Choose one badge for this conversation.</p>
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          <li>
            <button
              type="button"
              disabled={saving}
              onClick={() => onSelect("")}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                !selectedId
                  ? "border-[#8B5CF6] bg-[#F6F1FF] font-semibold text-slate-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span
                className="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                style={badgePillStyle(null, { allocated: false })}
              >
                {NOT_ALLOCATED_BADGE_LABEL}
              </span>
              {!selectedId ? <span className="text-xs text-[#7C3AED]">Selected</span> : null}
            </button>
          </li>
          {badges.map((badge) => {
            const isSelected = selectedId === badge.id;
            return (
              <li key={badge.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onSelect(badge.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    isSelected
                      ? "border-[#8B5CF6] bg-[#F6F1FF] font-semibold text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                    style={badgePillStyle(badge.color, { allocated: true })}
                  >
                    {badge.label}
                  </span>
                  {isSelected ? <span className="text-xs text-[#7C3AED]">Selected</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {!badges.length ? (
          <p className="mt-3 text-xs text-slate-500">
            No custom badges yet. Add badges in Settings first.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function pickVisitorNameFromCollected(collected) {
  if (!collected || typeof collected !== "object") return "";
  const entries = Object.entries(collected);
  const keyPatterns = [
    /^full\s*name$/i,
    /^name$/i,
    /^customer\s*name$/i,
    /^your\s*name$/i,
    /^first\s*name$/i,
    /^contact\s*name$/i,
  ];
  for (const re of keyPatterns) {
    for (const [key, val] of entries) {
      if (!re.test(String(key || "").trim())) continue;
      const s = String(val ?? "").trim();
      if (s.length >= 1 && s.length <= 120) return s;
    }
  }
  for (const [key, val] of entries) {
    const k = String(key || "").trim();
    if (!/name/i.test(k)) continue;
    if (/company|business|user\s*name|username|email/i.test(k)) continue;
    const s = String(val ?? "").trim();
    if (s.length >= 2 && s.length <= 120) return s;
  }
  return "";
}

function pickPhoneFromCollected(collected) {
  if (!collected || typeof collected !== "object") return "";
  const keyRes = [/phone/i, /mobile/i, /whatsapp/i, /\btel\b/i, /^cell$/i, /contact\s*(no\.?|number)?/i];
  for (const [key, val] of Object.entries(collected)) {
    const k = String(key || "").trim();
    if (!keyRes.some((re) => re.test(k))) continue;
    const s = String(val ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 18) return s.slice(0, 36);
  }
  return "";
}

function toE164Phone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) return "";
  return `+${digits}`;
}

function isWhatsappLidSession(session) {
  const jid = typeof session?.whatsappChatId === "string" ? session.whatsappChatId.trim() : "";
  if (jid.endsWith("@lid")) return true;
  const conversationId = typeof session?.conversationId === "string" ? session.conversationId.trim() : "";
  return conversationId.includes("_lid");
}

/** Customer WhatsApp number with country code (E.164), from API or JID fallback. */
function peerWhatsappNumber(session) {
  const stored =
    typeof session?.whatsappPeerPhone === "string" ? session.whatsappPeerPhone.trim() : "";
  const fromStored = toE164Phone(stored);
  if (fromStored) return fromStored;

  if (isWhatsappLidSession(session)) {
    const collected =
      session?.lead?.collectedData && typeof session.lead.collectedData === "object"
        ? session.lead.collectedData
        : {};
    return toE164Phone(pickPhoneFromCollected(collected));
  }

  const jid = typeof session?.whatsappChatId === "string" ? session.whatsappChatId.trim() : "";
  if (jid && jid.endsWith("@c.us")) {
    const localPart = jid.split("@")[0] || "";
    const fromJid = toE164Phone(localPart.split(":")[0]);
    if (fromJid) return fromJid;
  }

  const conversationId = typeof session?.conversationId === "string" ? session.conversationId.trim() : "";
  if (conversationId.startsWith("wa_") && conversationId.endsWith("_c_us")) {
    const digits = conversationId.slice(3, -5);
    return toE164Phone(digits);
  }

  const collected =
    session?.lead?.collectedData && typeof session.lead.collectedData === "object"
      ? session.lead.collectedData
      : {};
  return toE164Phone(pickPhoneFromCollected(collected));
}

function whatsappMessagingNumber(session) {
  if (normalizeChatSource(session) !== "whatsapp") return "";
  return peerWhatsappNumber(session);
}

/** Title for the visitor on the left list: real name from lead fields, else Web User / phone / Test User. */
function conversationPeerDisplayName(session) {
  const collected =
    session?.lead?.collectedData && typeof session.lead.collectedData === "object"
      ? session.lead.collectedData
      : {};
  const realName = pickVisitorNameFromCollected(collected);
  if (realName) return realName;

  const src = normalizeChatSource(session);
  if (src === "whatsapp") {
    const waNumber = peerWhatsappNumber(session);
    if (waNumber) return waNumber;
    const phone = pickPhoneFromCollected(collected);
    if (phone) return phone;
    return "WhatsApp Contact";
  }
  if (src === "web") return "Web User";
  return "Test User";
}

function conversationPeerSubtitle(session) {
  return whatsappMessagingNumber(session);
}

function lastMessageSenderLabel(role, peerDisplayName) {
  if (role === "user") return peerDisplayName || "Customer";
  if (role === "agent") return "Live Agent";
  if (role === "main_account") return "Main Account";
  if (role === "assistant") return "AI Agent";
  return "";
}

function avatarInitial(label) {
  const s = String(label || "").trim();
  if (!s) return "U";
  const ch = s.charAt(0);
  return /[0-9+]/.test(ch) ? "#" : ch.toUpperCase();
}

function toThreadMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter(
      (item) =>
        item &&
        (item.role === "user" ||
          item.role === "assistant" ||
          item.role === "agent" ||
          item.role === "main_account")
    )
    .map((item, idx) => {
      const createdAtMs = Date.parse(String(item.createdAt || ""));
      const text = typeof item.content === "string" ? item.content : "";
      const createdAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : "";
      const localId = typeof item.localId === "string" ? item.localId.trim() : "";
      return {
        id: localId || `${idx}-${item.role}-${createdAt || "t"}-${text.slice(0, 24)}`,
        messageIndex: idx,
        localId,
        whatsappMessageId:
          typeof item.whatsappMessageId === "string" ? item.whatsappMessageId.trim() : "",
        role: item.role,
        text,
        attachments: Array.isArray(item.attachments) ? item.attachments : [],
        createdAt,
        editedAt: typeof item.editedAt === "string" ? item.editedAt : "",
        deliveryStatus: item.role === "agent" ? "sent" : undefined,
        canModify: item.role === "agent" || item.role === "assistant" || item.role === "main_account",
      };
    })
    .filter((item) => item.text.trim().length > 0 || item.attachments.length > 0);
}

function Chats() {
  const location = useLocation();
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";

  const [selectedId, setSelectedId] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState([]);
  const [waStatus, setWaStatus] = useState(null);
  const [accountFilter, setAccountFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveDraft, setLiveDraft] = useState("");
  const [liveSaving, setLiveSaving] = useState(false);
  const [messageActionSaving, setMessageActionSaving] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  /** Optimistic live-agent bubbles shown while WhatsApp/API delivery is in flight. */
  const [pendingLiveMessages, setPendingLiveMessages] = useState([]);
  const [listHoverPreview, setListHoverPreview] = useState(null);
  const [conversationBadges, setConversationBadges] = useState([]);
  const [badgePicker, setBadgePicker] = useState(null);
  const [badgeSaving, setBadgeSaving] = useState(false);
  /** conversationId → fingerprint of the last live-agent customer message the operator has opened. */
  const [seenLiveFingerprints, setSeenLiveFingerprints] = useState({});
  const syncedOnLoadRef = useRef(false);
  const conversationIdFromNav =
    (typeof location.state?.conversationId === "string" && location.state.conversationId.trim()) ||
    new URLSearchParams(location.search).get("conversationId") ||
    "";
  const threadScrollRef = useRef(null);
  const liveInputRef = useRef(null);
  const pendingLiveDraftCursorRef = useRef(null);

  const needsFastRefresh = useMemo(() => {
    const waConnected =
      (Number(waStatus?.connectedCount) || 0) > 0 ||
      (Array.isArray(waStatus?.accounts) &&
        waStatus.accounts.some((account) => account.connected || account.phase === "ready"));
    return (
      waConnected ||
      sessions.some(
        (session) =>
          Boolean(session?.liveAgentEnabled) ||
          String(session?.chatSource || "").toLowerCase() === "whatsapp"
      )
    );
  }, [sessions, waStatus]);

  const mergeSessionSummary = (prev, list) => {
    const prevById = new Map(prev.map((session) => [session.id, session]));
    const prevByConversationId = new Map(
      prev.map((session) => [String(session.conversationId || ""), session])
    );
    return list.map((session) => {
      const existing =
        prevById.get(session.id) ||
        prevByConversationId.get(String(session.conversationId || "")) ||
        null;
      if (!existing) return session;
      // Keep hydrated thread bodies when the list poll is summary-only.
      if (!Array.isArray(session.messages) && Array.isArray(existing.messages)) {
        return {
          ...existing,
          ...session,
          messages: existing.messages,
          lead: session.lead ?? existing.lead,
        };
      }
      return { ...existing, ...session };
    });
  };

  // Initial list + polling — summary payload (no full message bodies) for faster paint/polls.
  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function loadSessionList(isBackgroundRefresh = false) {
      if (!isBackgroundRefresh) {
        setLoading(true);
        setError("");
      }
      try {
        if (!userId) {
          if (!active) return;
          setSessions([]);
          setSelectedId("");
          return;
        }
        const res = await fetch(
          apiUrl(
            `/chat/test/sessions?userId=${encodeURIComponent(userId)}&summary=1`
          )
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Could not load chat sessions");
        }
        if (!active) return;
        const list = (Array.isArray(data.sessions) ? data.sessions : []).filter(
          (session) => !isWhatsAppGroupSession(session)
        );
        setSessions((prev) => (isBackgroundRefresh ? mergeSessionSummary(prev, list) : list));
        setSelectedId((prev) => {
          if (conversationIdFromNav) {
            const matched = list.find(
              (item) => String(item.conversationId || "") === String(conversationIdFromNav)
            );
            if (matched?.id) return matched.id;
          }
          // Keep current selection if it still exists; otherwise leave empty (no auto-open).
          if (prev && list.some((item) => item.id === prev)) return prev;
          return "";
        });
      } catch (err) {
        if (!active) return;
        if (!isBackgroundRefresh) {
          setSessions([]);
          setSelectedId("");
        }
        setError(err instanceof Error ? err.message : "Could not load chat sessions");
      } finally {
        if (active && !isBackgroundRefresh) {
          setLoading(false);
        }
      }
    }

    void loadSessionList(false);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [userId, conversationIdFromNav]);

  useEffect(() => {
    let active = true;
    async function loadBadges() {
      if (!userId) {
        if (active) setConversationBadges([]);
        return;
      }
      try {
        const res = await fetch(apiUrl(`/widget-settings?userId=${encodeURIComponent(userId)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        setConversationBadges(normalizeConversationBadges(data?.settings?.conversationBadges));
      } catch {
        if (active) setConversationBadges([]);
      }
    }
    void loadBadges();
    return () => {
      active = false;
    };
  }, [userId]);

  // Poll session list separately so changing poll speed never re-triggers the loading spinner.
  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const pollMs = needsFastRefresh ? CHATS_WA_CONNECTED_POLL_MS : CHATS_OPERATOR_POLL_MS;

    async function refreshList() {
      try {
        const res = await fetch(
          apiUrl(
            `/chat/test/sessions?userId=${encodeURIComponent(userId)}&summary=1`
          )
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        const list = (Array.isArray(data.sessions) ? data.sessions : []).filter(
          (session) => !isWhatsAppGroupSession(session)
        );
        setSessions((prev) => mergeSessionSummary(prev, list));
      } catch {
        /* keep last good list on background failures */
      }
    }

    const intervalId = setInterval(() => {
      if (!document.hidden) void refreshList();
    }, pollMs);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [userId, needsFastRefresh]);

  // WhatsApp status loads independently so a slow WA check never blocks the chat list.
  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function loadWaStatus() {
      if (!userId) {
        if (active) setWaStatus(null);
        return;
      }
      try {
        const waRes = await fetch(
          apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`),
          { cache: "no-store" }
        );
        const waPayload = await waRes.json().catch(() => ({}));
        if (!active) return;
        setWaStatus(waRes.ok && waPayload && typeof waPayload === "object" ? waPayload : null);
      } catch {
        if (active) setWaStatus(null);
      }
    }

    void loadWaStatus();
    intervalId = setInterval(() => {
      if (!document.hidden) void loadWaStatus();
    }, CHATS_WA_STATUS_POLL_MS);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [userId]);

  const selectedConversationId = useMemo(() => {
    const current = sessions.find((session) => session.id === selectedId);
    return typeof current?.conversationId === "string" ? current.conversationId.trim() : "";
  }, [sessions, selectedId]);

  // Hydrate full messages for the selected conversation (and keep them fresh while open).
  useEffect(() => {
    if (!userId || !selectedId || !selectedConversationId) return undefined;
    let active = true;
    let intervalId = null;
    const conversationId = selectedConversationId;

    async function loadActiveThread() {
      try {
        const query = `?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(
          conversationId
        )}`;
        const res = await fetch(apiUrl(`/chat/test/session${query}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        const session = data?.session;
        if (!session || typeof session !== "object") return;
        const lead =
          data?.lead && typeof data.lead === "object"
            ? {
                fieldLabels: Array.isArray(data.lead.fieldLabels) ? data.lead.fieldLabels : [],
                collectedData:
                  data.lead.collectedData && typeof data.lead.collectedData === "object"
                    ? data.lead.collectedData
                    : {},
                collectedCount: Number(data.lead.collectedCount) || 0,
                updatedAt: typeof data.lead.updatedAt === "string" ? data.lead.updatedAt : null,
              }
            : session.lead || null;
        setSessions((prev) =>
          prev.map((item) =>
            item.id === selectedId || item.conversationId === conversationId
              ? { ...item, ...session, lead: lead ?? item.lead }
              : item
          )
        );
      } catch {
        /* ignore background thread refresh errors */
      }
    }

    void loadActiveThread();
    intervalId = setInterval(() => {
      if (!document.hidden) void loadActiveThread();
    }, CHATS_ACTIVE_THREAD_POLL_MS);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [userId, selectedId, selectedConversationId]);

  useEffect(() => {
    if (!userId || syncedOnLoadRef.current) return;
    const accounts = Array.isArray(waStatus?.accounts) ? waStatus.accounts : [];
    const connected = accounts.filter((account) => account.connected || account.phase === "ready");
    if (!connected.length) return;
    syncedOnLoadRef.current = true;
    void (async () => {
      try {
        const res = await fetch(apiUrl("/integrations/whatsapp/sync-conversations"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const sessionsRes = await fetch(
          apiUrl(
            `/chat/test/sessions?userId=${encodeURIComponent(userId)}&summary=1`
          )
        );
        const payload = await sessionsRes.json().catch(() => ({}));
        const list = (Array.isArray(payload.sessions) ? payload.sessions : []).filter(
          (session) => !isWhatsAppGroupSession(session)
        );
        if (list.length) setSessions((prev) => mergeSessionSummary(prev, list));
      } catch {
        /* ignore background sync errors */
      }
    })();
  }, [userId, waStatus]);

  const whatsappAccountOptions = useMemo(() => {
    const accounts = Array.isArray(waStatus?.accounts) ? waStatus.accounts : [];
    const connected = accounts.filter((account) => account.connected || account.phase === "ready");
    const options = [{ value: "all", label: "All sources" }];
    connected.forEach((account) => {
      const accountId = String(account.accountId || "1");
      options.push({
        value: `whatsapp:${accountId}`,
        label: whatsAppAccountLabel(account),
      });
    });
    return options;
  }, [waStatus]);

  const accountFilteredSessions = useMemo(() => {
    if (accountFilter === "all") return sessions;
    return sessions.filter((session) => {
      const key = getAccountFilterKey(session);
      if (accountFilter.startsWith("whatsapp:")) return key === accountFilter;
      return true;
    });
  }, [accountFilter, sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const prepared = accountFilteredSessions.map((session, idx) => {
      const messages = toThreadMessages(session.messages);
      const lastFromThread = messages[messages.length - 1];
      const preview =
        typeof session.lastReplyPreview === "string" && session.lastReplyPreview.trim()
          ? session.lastReplyPreview.trim()
          : lastFromThread?.text || "No messages yet.";
      const lastRole =
        typeof session.lastReplyRole === "string" && session.lastReplyRole.trim()
          ? session.lastReplyRole.trim()
          : lastFromThread?.role || "";
      const sourceLabel = formatSessionSourceLabel(session);
      const displayName = conversationPeerDisplayName(session);
      const peerSubtitle = conversationPeerSubtitle(session);
      const whatsappNumber = whatsappMessagingNumber(session);
      const lastSender = lastMessageSenderLabel(lastRole, displayName);
      const conversationId =
        typeof session.conversationId === "string" ? session.conversationId.trim() : "";
      const badgeId = typeof session.badgeId === "string" ? session.badgeId.trim() : "";
      const assignedBadge = findConversationBadge(badgeId, conversationBadges);
      const documentCount = Number(session.documentCount) || 0;
      const documentLabel =
        typeof session.documentLabel === "string" ? session.documentLabel.trim() : "";
      const hasDocument = Boolean(session.hasDocument) || documentCount > 0;
      const sessionId = session.id || `session-${idx}`;
      const fingerprint = liveAgentMessageFingerprint(session, lastRole);
      const isSelected = sessionId === selectedId;
      const hasNewMessage =
        !isSelected &&
        Boolean(session.liveAgentEnabled) &&
        lastRole === "user" &&
        Boolean(conversationId) &&
        Boolean(fingerprint) &&
        seenLiveFingerprints[conversationId] !== fingerprint;
      return {
        id: sessionId,
        displayName,
        peerSubtitle,
        whatsappNumber,
        preview,
        lastSender,
        time: formatConversationTime(session.updatedAt || session.createdAt),
        sourceLabel,
        sourceKey: sessionSourceStyleKey(session),
        conversationId,
        badgeId,
        assignedBadge,
        hasDocument,
        documentCount,
        documentLabel,
        hasNewMessage,
      };
    });
    if (!q) return prepared;
    return prepared.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.peerSubtitle.toLowerCase().includes(q) ||
        c.whatsappNumber.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q) ||
        c.lastSender.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q) ||
        (c.assignedBadge?.label || NOT_ALLOCATED_BADGE_LABEL).toLowerCase().includes(q) ||
        (c.hasDocument && (c.documentLabel || "document").toLowerCase().includes(q))
    );
  }, [query, accountFilteredSessions, seenLiveFingerprints, selectedId, conversationBadges]);

  const active = selectedId ? filtered.find((c) => c.id === selectedId) ?? null : null;
  const activeSession = sessions.find((session) => session.id === active?.id) ?? null;
  const persistedMessages = toThreadMessages(activeSession?.messages);
  const pendingForActive = useMemo(() => {
    const conversationId = activeSession?.conversationId;
    if (!conversationId) return [];
    return pendingLiveMessages.filter((item) => item.conversationId === conversationId);
  }, [activeSession?.conversationId, pendingLiveMessages]);
  const messages = useMemo(
    () => [...persistedMessages, ...pendingForActive],
    [persistedMessages, pendingForActive]
  );
  const liveAgentEnabled = Boolean(activeSession?.liveAgentEnabled);
  const leadCollected =
    activeSession?.lead?.collectedData && typeof activeSession.lead.collectedData === "object"
      ? activeSession.lead.collectedData
      : {};

  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active?.id, messages.length, mobileShowThread]);

  const markLiveMessageSeen = (session) => {
    if (!session?.liveAgentEnabled) return;
    const conversationId =
      typeof session.conversationId === "string" ? session.conversationId.trim() : "";
    if (!conversationId) return;
    const threadMessages = toThreadMessages(session.messages);
    const lastFromThread = threadMessages[threadMessages.length - 1];
    const lastRole =
      typeof session.lastReplyRole === "string" && session.lastReplyRole.trim()
        ? session.lastReplyRole.trim()
        : lastFromThread?.role || "";
    if (lastRole !== "user") return;
    const fingerprint = liveAgentMessageFingerprint(session, lastRole);
    if (!fingerprint) return;
    setSeenLiveFingerprints((prev) => {
      if (prev[conversationId] === fingerprint) return prev;
      return { ...prev, [conversationId]: fingerprint };
    });
  };

  // Mark as seen as soon as this conversation is selected (before paint) so the icon never sticks.
  useLayoutEffect(() => {
    if (!activeSession) return;
    markLiveMessageSeen(activeSession);
  }, [activeSession]);

  const openThread = (id) => {
    setSelectedId(id);
    setMobileShowThread(true);
    const session = sessions.find((item) => item.id === id);
    markLiveMessageSeen(session);
  };

  const backToList = () => setMobileShowThread(false);

  const openBadgePicker = (conversationId, badgeId) => {
    if (!conversationId) return;
    setBadgePicker({ conversationId, badgeId: String(badgeId || "").trim() });
  };

  const assignConversationBadge = async (badgeId) => {
    if (!badgePicker?.conversationId || !userId || badgeSaving) return;
    setBadgeSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/session-badge"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId: badgePicker.conversationId,
          badgeId: badgeId || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not update badge");
      const updated = data?.session;
      if (updated?.id) {
        setSessions((prev) =>
          prev.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
        );
      }
      setBadgePicker(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update badge");
    } finally {
      setBadgeSaving(false);
    }
  };

  const toggleLiveAgent = async (enabled) => {
    if (!activeSession || !userId) return;
    setLiveSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/live-agent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId: activeSession.conversationId,
          enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not update live agent mode");
      const updated = data?.session;
      setSessions((prev) =>
        prev.map((session) => (session.id === updated?.id ? updated : session))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update live agent mode");
    } finally {
      setLiveSaving(false);
    }
  };

  const sendLiveMessage = async () => {
    if (!activeSession || !userId || !liveAgentEnabled || liveSaving) return;
    const message = liveDraft.trim();
    if (!message) return;
    const conversationId = activeSession.conversationId;
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingBubble = {
      id: pendingId,
      conversationId,
      role: "agent",
      text: message,
      attachments: [],
      createdAt: new Date().toISOString(),
      deliveryStatus: "pending",
    };
    setLiveDraft("");
    setPendingLiveMessages((prev) => [...prev, pendingBubble]);
    setLiveSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/live-message"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId,
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.session) {
          setSessions((prev) =>
            prev.map((session) => (session.id === data.session?.id ? data.session : session))
          );
        }
        throw new Error(data.message || "Could not send live agent reply");
      }
      const updated = data?.session;
      setSessions((prev) =>
        prev.map((session) => (session.id === updated?.id ? updated : session))
      );
      setPendingLiveMessages((prev) => prev.filter((item) => item.id !== pendingId));
    } catch (err) {
      setPendingLiveMessages((prev) => prev.filter((item) => item.id !== pendingId));
      setLiveDraft((prev) => (prev.trim() ? prev : message));
      setError(err instanceof Error ? err.message : "Could not send live agent reply");
    } finally {
      setLiveSaving(false);
    }
  };

  useLayoutEffect(() => {
    const cursor = pendingLiveDraftCursorRef.current;
    const input = liveInputRef.current;
    if (cursor === null || !input) return;
    input.selectionStart = cursor;
    input.selectionEnd = cursor;
    pendingLiveDraftCursorRef.current = null;
  }, [liveDraft]);

  const handleLiveDraftKeyDown = (e) => {
    if (e.key !== "Enter" || !liveAgentEnabled) return;
    if (e.ctrlKey) {
      e.preventDefault();
      const input = e.currentTarget;
      const start = input.selectionStart ?? liveDraft.length;
      const end = input.selectionEnd ?? liveDraft.length;
      pendingLiveDraftCursorRef.current = start + 1;
      setLiveDraft(`${liveDraft.slice(0, start)}\n${liveDraft.slice(end)}`);
      return;
    }
    e.preventDefault();
    void sendLiveMessage();
  };

  const startEditMessage = (message) => {
    if (!message?.canModify || messageActionSaving) return;
    setEditingMessage({
      localId: message.localId,
      messageIndex: message.messageIndex,
    });
    setEditDraft(message.text);
  };

  const cancelEditMessage = () => {
    setEditingMessage(null);
    setEditDraft("");
  };

  const saveEditMessage = async () => {
    if (!activeSession || !userId || !editingMessage || messageActionSaving) return;
    const content = editDraft.trim();
    if (!content) return;
    setMessageActionSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/message-edit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId: activeSession.conversationId,
          localId: editingMessage.localId || undefined,
          messageIndex: editingMessage.messageIndex,
          content,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Could not edit message");
      }
      const updated = data?.session;
      if (updated?.id) {
        setSessions((prev) =>
          prev.map((session) => (session.id === updated.id ? updated : session))
        );
      }
      cancelEditMessage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not edit message");
    } finally {
      setMessageActionSaving(false);
    }
  };

  const deleteMessage = async (message) => {
    if (!activeSession || !userId || !message?.canModify || messageActionSaving) return;
    const label = message.role === "agent" ? "live agent message" : "message";
    if (!window.confirm(`Delete this ${label}? This will also remove it on the customer's WhatsApp when possible.`)) {
      return;
    }
    setMessageActionSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/message-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId: activeSession.conversationId,
          localId: message.localId || undefined,
          messageIndex: message.messageIndex,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Could not delete message");
      }
      const updated = data?.session;
      if (updated?.id) {
        setSessions((prev) =>
          prev.map((session) => (session.id === updated.id ? updated : session))
        );
      }
      if (
        editingMessage &&
        editingMessage.messageIndex === message.messageIndex &&
        (editingMessage.localId ? editingMessage.localId === message.localId : true)
      ) {
        cancelEditMessage();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete message");
    } finally {
      setMessageActionSaving(false);
    }
  };

  const handleEditDraftKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditMessage();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveEditMessage();
    }
  };

  return (
    <div className="workspace-fill flex min-h-[360px] w-full min-w-0 flex-1 flex-col lg:min-h-0">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-[#F0E9FF] bg-white shadow-[0_18px_50px_rgba(139,92,246,0.08)] sm:rounded-3xl lg:min-h-0 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* Conversation list — fixed 380px on desktop so width never shifts */}
        <section
          className={`flex min-h-0 w-full flex-col overflow-hidden border-[#EEE8FF] lg:max-w-[380px] lg:shrink-0 lg:border-r ${
            mobileShowThread ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-[#EEE8FF] p-4">
            <h1 className="text-[15px] font-bold tracking-tight text-slate-900 md:text-lg">Chats</h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Test Bot, Web widget, and WhatsApp threads — source shown on each row.
            </p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Legend:{" "}
              <span className="text-violet-600">Test Bot</span>
              <span className="mx-1 text-slate-300">|</span>
              <span className="text-sky-600">Web</span>
              <span className="mx-1 text-slate-300">|</span>
              <span className="text-emerald-600">WhatsApp (account)</span>
            </p>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-xl border border-[#EEE8FF] bg-[#FDFCFF] py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
              />
            </div>
            {whatsappAccountOptions.length > 1 ? (
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="mt-2 w-full rounded-xl border border-[#EEE8FF] bg-[#FDFCFF] px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
                aria-label="Filter by WhatsApp account"
              >
                {whatsappAccountOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <ul
            className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
            onScroll={() => setListHoverPreview(null)}
          >
            {loading ? (
              <li className="px-3 py-8 text-center text-sm text-slate-400">Loading conversations…</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-slate-400">No conversations match.</li>
            ) : (
              filtered.map((c) => {
                const isActive = c.id === selectedId;
                const showUnread = Boolean(c.hasNewMessage) && !isActive;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openThread(c.id)}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const tipWidth = 288;
                        const left = Math.min(
                          rect.right + 10,
                          Math.max(12, window.innerWidth - tipWidth - 12)
                        );
                        const top = Math.min(
                          Math.max(rect.top + rect.height / 2, 72),
                          window.innerHeight - 72
                        );
                        setListHoverPreview({
                          id: c.id,
                          top,
                          left,
                          sender: c.lastSender,
                          preview: c.preview,
                        });
                      }}
                      onMouseLeave={() => setListHoverPreview(null)}
                      onFocus={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const tipWidth = 288;
                        const left = Math.min(
                          rect.right + 10,
                          Math.max(12, window.innerWidth - tipWidth - 12)
                        );
                        const top = Math.min(
                          Math.max(rect.top + rect.height / 2, 72),
                          window.innerHeight - 72
                        );
                        setListHoverPreview({
                          id: c.id,
                          top,
                          left,
                          sender: c.lastSender,
                          preview: c.preview,
                        });
                      }}
                      onBlur={() => setListHoverPreview(null)}
                      className={`flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        isActive
                          ? "bg-gradient-to-r from-[#8B5CF6]/12 to-[#A78BFA]/10 ring-1 ring-[#8B5CF6]/25"
                          : "hover:bg-[#F6F1FF]"
                      }`}
                    >
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#EEE8FF] bg-[#F4ECFF] text-sm font-bold text-[#7C3AED]">
                        {avatarInitial(c.displayName)}
                        {showUnread ? (
                          <span
                            className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#8B5CF6] text-white shadow ring-2 ring-white"
                            title="New message"
                            aria-label="New message"
                          >
                            <MessageSquareDot size={10} strokeWidth={2.5} aria-hidden />
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
            <span
                              className={`truncate text-[13px] font-semibold sm:text-sm ${
                                showUnread ? "text-slate-900" : "text-slate-800"
                              }`}
                            >
                              {c.displayName}
                            </span>
                            {c.whatsappNumber ? (
                              <p className="truncate text-[11px] font-semibold text-emerald-700">
                                WhatsApp {c.whatsappNumber}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {c.time}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span
                            className={`truncate text-xs ${
                              showUnread ? "font-semibold text-slate-700" : "text-slate-500"
                            }`}
                          >
                            {c.preview}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                              SOURCE_BADGE_CLASS[c.sourceKey] || SOURCE_BADGE_CLASS.test_bot
                            }`}
                          >
                            {c.sourceLabel}
                          </span>
                          <ConversationBadgeButton
                            badge={c.assignedBadge}
                            onClick={(e) => {
                              e.stopPropagation();
                              openBadgePicker(c.conversationId, c.badgeId);
                            }}
                          />
                          {c.hasDocument ? (
                            <ConversationDocumentIndicator
                              documentCount={c.documentCount}
                              documentLabel={c.documentLabel}
                            />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {listHoverPreview ? (
            <div
              role="tooltip"
              className="pointer-events-none fixed z-50 hidden max-w-xs -translate-y-1/2 rounded-xl border border-[#EEE8FF] bg-white px-3 py-2.5 shadow-lg shadow-slate-900/10 lg:block"
              style={{ top: listHoverPreview.top, left: listHoverPreview.left }}
            >
              {listHoverPreview.sender ? (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7C3AED]">
                  {listHoverPreview.sender}
                </p>
              ) : null}
              <p className="mt-0.5 text-sm leading-snug text-slate-700 line-clamp-4">
                {listHoverPreview.preview}
              </p>
            </div>
          ) : null}
        </section>

        {/* Thread */}
        <section
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#FCFAFF]/60 ${
            mobileShowThread ? "flex" : "hidden lg:flex"
          }`}
        >
          {active ? (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-[#EEE8FF] bg-white px-2 py-3 sm:gap-3 sm:px-3 lg:px-4">
                <button
                  type="button"
                  onClick={backToList}
                  className="rounded-lg p-2 text-slate-600 hover:bg-[#F6F1FF] lg:hidden"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#EEE8FF] bg-[#F4ECFF] text-sm font-bold text-[#7C3AED]">
                  {avatarInitial(active.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{active.displayName}</p>
                  {active.whatsappNumber ? (
                    <p className="truncate text-xs font-semibold text-emerald-700">
                      WhatsApp {active.whatsappNumber}
                    </p>
                  ) : null}
                  <p className="truncate text-xs text-slate-400">
                    <span
                      className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        SOURCE_BADGE_CLASS[active.sourceKey] || SOURCE_BADGE_CLASS.test_bot
                      }`}
                    >
                      {active.sourceLabel}
                    </span>
                    <ConversationBadgeButton
                      badge={active.assignedBadge}
                      className="mr-1.5 align-middle"
                      onClick={() => openBadgePicker(active.conversationId, active.badgeId)}
                    />
                    {active.hasDocument ? (
                      <ConversationDocumentIndicator
                        documentCount={active.documentCount}
                        documentLabel={active.documentLabel}
                        className="mr-1.5 align-middle"
                      />
                    ) : null}
                    · {messages.length} messages
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#EEE8FF] bg-[#FDFCFF] px-2 py-1.5 text-[11px] font-semibold text-slate-600 sm:gap-2 sm:px-2.5 sm:text-xs">
                  <span className="hidden sm:inline">Ai chat disable</span>
                  <span className="sm:hidden">AI off</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={liveAgentEnabled}
                    aria-label="Toggle Ai chat disable"
                    disabled={liveSaving}
                    onClick={() => void toggleLiveAgent(!liveAgentEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      liveAgentEnabled ? "bg-[#8B5CF6]" : "bg-slate-300"
                    } ${liveSaving ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        liveAgentEnabled ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
                <button
                  type="button"
                  className="hidden shrink-0 rounded-lg p-2 text-slate-500 hover:bg-[#F6F1FF] sm:inline-flex"
                  aria-label="More"
                >
                  <MoreVertical size={18} />
                </button>
              </header>

              {active.whatsappNumber ? (
                <div className="shrink-0 border-b border-emerald-100 bg-emerald-50/80 px-4 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                    Messaging WhatsApp number
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-900">{active.whatsappNumber}</p>
                </div>
              ) : null}

              <div ref={threadScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {Object.keys(leadCollected).length > 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Collected Data
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {Object.entries(leadCollected).map(([key, value]) => (
                        <p key={key} className="text-sm text-slate-700">
                          <span className="font-semibold">{key}:</span> {String(value)}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {messages.map((m) => {
                  const isCustomer = m.role === "user";
                  const isLiveAgent = m.role === "agent";
                  const isMainAccount = m.role === "main_account";
                  const isPending = isLiveAgent && m.deliveryStatus === "pending";
                  const isSent = isLiveAgent && m.deliveryStatus === "sent";
                  const isEditing =
                    editingMessage &&
                    editingMessage.messageIndex === m.messageIndex &&
                    (editingMessage.localId
                      ? editingMessage.localId === m.localId
                      : true);
                  const timeLabel = formatMessageTimestamp(m.createdAt);
                  const editedLabel = m.editedAt ? formatMessageTimestamp(m.editedAt) : "";
                  const senderLabel = isMainAccount
                    ? "Main Account"
                    : isLiveAgent
                    ? "Live Agent"
                    : "AI Agent";
                  return (
                    <div
                      key={m.id}
                      className={`group/msg flex ${isCustomer ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`relative max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                          isCustomer
                            ? "rounded-bl-md bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] text-white"
                            : isPending
                            ? "rounded-br-md border border-orange-300 bg-orange-50 text-slate-800"
                            : isMainAccount
                            ? "rounded-br-md border border-blue-300 bg-blue-50 text-slate-800"
                            : isSent || isLiveAgent
                            ? "rounded-br-md border border-emerald-300 bg-emerald-50 text-slate-800"
                            : "rounded-br-md border border-[#EEE8FF] bg-white text-slate-800"
                        }`}
                      >
                        {!isCustomer ? (
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p
                              className={`text-[10px] font-semibold uppercase tracking-wide ${
                                isPending
                                  ? "text-orange-600"
                                  : isMainAccount
                                  ? "text-blue-700"
                                  : isLiveAgent
                                  ? "text-emerald-700"
                                  : "text-slate-400"
                              }`}
                            >
                              {senderLabel}
                            </p>
                            {m.canModify && !isPending && !isEditing ? (
                              <div className="flex items-center gap-0.5 opacity-0 transition group-hover/msg:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => startEditMessage(m)}
                                  disabled={messageActionSaving}
                                  className="rounded p-1 text-slate-400 hover:bg-white/80 hover:text-violet-600 disabled:opacity-40"
                                  title="Edit message"
                                  aria-label="Edit message"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteMessage(m)}
                                  disabled={messageActionSaving}
                                  className="rounded p-1 text-slate-400 hover:bg-white/80 hover:text-red-600 disabled:opacity-40"
                                  title="Delete message"
                                  aria-label="Delete message"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              rows={3}
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={handleEditDraftKeyDown}
                              className="w-full resize-y rounded-lg border border-[#EEE8FF] bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelEditMessage}
                                disabled={messageActionSaving}
                                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-white/80"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveEditMessage()}
                                disabled={messageActionSaving || !editDraft.trim()}
                                className="rounded-lg bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : m.text.trim() ? (
                          <MessageText
                            text={m.text}
                            linkClassName={
                              isCustomer
                                ? "underline underline-offset-2 break-all text-white hover:opacity-90"
                                : "underline underline-offset-2 break-all text-[#6D28D9] hover:opacity-90"
                            }
                          />
                        ) : null}
                        {!isEditing && Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                          <AssistantAttachments
                            attachments={m.attachments}
                            variant={isCustomer ? "customer" : "default"}
                          />
                        ) : null}
                        {!isEditing ? (
                          <div
                            className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] font-medium ${
                              isCustomer ? "text-white/75" : "text-slate-400"
                            }`}
                          >
                            {isPending ? (
                              <span className="font-semibold text-orange-600">Sending…</span>
                            ) : null}
                            {isSent || (isLiveAgent && !isPending) ? (
                              <span className="font-semibold text-emerald-600">Sent</span>
                            ) : null}
                            {editedLabel ? <span>Edited {editedLabel}</span> : null}
                            {timeLabel ? <span>{timeLabel}</span> : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {!messages.length ? (
                  <div className="py-6 text-center text-sm text-slate-400">
                    No messages in this session yet.
                  </div>
                ) : null}
              </div>

              <footer className="shrink-0 border-t border-[#EEE8FF] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4">
                <div className="flex gap-2 rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-1.5 focus-within:border-[#C4B5FD] focus-within:ring-2 focus-within:ring-[#8B5CF6]/15">
                  <textarea
                    ref={liveInputRef}
                    rows={1}
                    value={liveDraft}
                    onChange={(e) => setLiveDraft(e.target.value)}
                    onKeyDown={handleLiveDraftKeyDown}
                    placeholder={
                      liveAgentEnabled ? "Type as live agent…" : "Enable Live Agent to reply directly…"
                    }
                    className="min-h-[40px] max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    disabled={!liveAgentEnabled || liveSaving}
                  />
                  <button
                    type="button"
                    onClick={() => void sendLiveMessage()}
                    disabled={!liveAgentEnabled || liveSaving || !liveDraft.trim()}
                    className="flex shrink-0 items-center justify-center rounded-xl bg-[#8B5CF6] p-2.5 text-white disabled:opacity-50"
                    aria-label="Send"
                  >
                    <Send size={16} />
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] text-slate-400">
                  {liveAgentEnabled
                    ? "Live Agent mode active: OpenAI replies are paused. Enter to send, Ctrl+Enter for a new line."
                    : "Enable Live Agent to send manual replies from this page."}
                </p>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
              <p className="text-sm font-medium text-slate-500">Select a conversation</p>
              <p className="max-w-xs text-xs leading-relaxed">
                Choose a conversation from the side navbar to view the full conversation.
              </p>
            </div>
          )}
        </section>
      </div>
      <BadgePickerModal
        open={Boolean(badgePicker)}
        badges={conversationBadges}
        currentBadgeId={badgePicker?.badgeId || ""}
        saving={badgeSaving}
        onClose={() => {
          if (!badgeSaving) setBadgePicker(null);
        }}
        onSelect={(badgeId) => void assignConversationBadge(badgeId)}
      />
      {error ? (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default Chats;
