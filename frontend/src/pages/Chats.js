import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, MoreVertical, Search, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { AssistantAttachments } from "../components/AssistantAttachments";

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

const SOURCE_BADGE_CLASS = {
  test_bot: "bg-violet-100 text-violet-800 ring-1 ring-violet-200/80",
  web: "bg-sky-100 text-sky-800 ring-1 ring-sky-200/80",
  whatsapp: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80",
};

function normalizeChatSource(session) {
  const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
  if (raw === "web") return "web";
  if (raw === "whatsapp") return "whatsapp";
  return "test_bot";
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
    const phone = pickPhoneFromCollected(collected);
    if (phone) return phone;
    return "WhatsApp";
  }
  if (src === "web") return "Web User";
  return "Test User";
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
    .filter((item) => item && (item.role === "user" || item.role === "assistant" || item.role === "agent"))
    .map((item, idx) => ({
      id: `${idx}-${item.role}`,
      role: item.role,
      text: typeof item.content === "string" ? item.content : "",
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
    }))
    .filter((item) => item.text.trim().length > 0);
}

function Chats() {
  const location = useLocation();
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";

  const [selectedId, setSelectedId] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveDraft, setLiveDraft] = useState("");
  const [liveSaving, setLiveSaving] = useState(false);
  const conversationIdFromQuery = new URLSearchParams(location.search).get("conversationId") || "";

  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function loadChats(isBackgroundRefresh = false) {
      if (!isBackgroundRefresh) {
        setLoading(true);
      }
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setSessions([]);
          setSelectedId("");
          return;
        }
        const res = await fetch(apiUrl(`/chat/test/sessions?userId=${encodeURIComponent(userId)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Could not load chat sessions");
        }
        if (!active) return;
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        setSessions(list);
        setSelectedId((prev) => {
          if (conversationIdFromQuery) {
            const matched = list.find(
              (item) => String(item.conversationId || "") === String(conversationIdFromQuery)
            );
            if (matched?.id) return matched.id;
          }
          if (prev && list.some((item) => item.id === prev)) return prev;
          return list[0]?.id || "";
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

    loadChats(false);
    intervalId = setInterval(() => {
      if (!document.hidden) {
        void loadChats(true);
      }
    }, 4000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [userId, conversationIdFromQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const prepared = sessions.map((session, idx) => {
      const messages = toThreadMessages(session.messages);
      const preview = typeof session.lastReplyPreview === "string" && session.lastReplyPreview.trim()
        ? session.lastReplyPreview.trim()
        : messages[messages.length - 1]?.text || "No messages yet.";
      const sourceLabel = formatSessionSourceLabel(session);
      const displayName = conversationPeerDisplayName(session);
      return {
        id: session.id || `session-${idx}`,
        displayName,
        preview,
        time: formatConversationTime(session.updatedAt || session.createdAt),
        sourceLabel,
        sourceKey: sessionSourceStyleKey(session),
        unread: 0,
      };
    });
    if (!q) return prepared;
    return prepared.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q)
    );
  }, [query, sessions]);

  const active = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;
  const activeSession = sessions.find((session) => session.id === active?.id) ?? null;
  const messages = toThreadMessages(activeSession?.messages);
  const liveAgentEnabled = Boolean(activeSession?.liveAgentEnabled);
  const leadCollected =
    activeSession?.lead?.collectedData && typeof activeSession.lead.collectedData === "object"
      ? activeSession.lead.collectedData
      : {};

  const openThread = (id) => {
    setSelectedId(id);
    setMobileShowThread(true);
  };

  const backToList = () => setMobileShowThread(false);

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
    setLiveSaving(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/chat/test/live-message"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId: activeSession.conversationId,
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not send live agent reply");
      const updated = data?.session;
      setLiveDraft("");
      setSessions((prev) =>
        prev.map((session) => (session.id === updated?.id ? updated : session))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send live agent reply");
    } finally {
      setLiveSaving(false);
    }
  };

  return (
    <div className="flex min-h-[420px] w-full flex-1 flex-col xl:h-full xl:min-h-0">
      <div className="grid min-h-[360px] flex-1 grid-cols-1 overflow-hidden rounded-3xl border border-[#F0E9FF] bg-white shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0 lg:grid-cols-[minmax(260px,34%)_1fr]">
        {/* Conversation list */}
        <section
          className={`flex min-h-0 flex-1 flex-col border-[#EEE8FF] lg:border-r ${
            mobileShowThread ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-[#EEE8FF] p-4">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Chats</h1>
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
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {loading ? (
              <li className="px-3 py-8 text-center text-sm text-slate-400">Loading conversations…</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-slate-400">No conversations match.</li>
            ) : (
              filtered.map((c) => {
                const isActive = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openThread(c.id)}
                      className={`flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        isActive
                          ? "bg-gradient-to-r from-[#8B5CF6]/12 to-[#A78BFA]/10 ring-1 ring-[#8B5CF6]/25"
                          : "hover:bg-[#F6F1FF]"
                      }`}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#EEE8FF] bg-[#F4ECFF] text-sm font-bold text-[#7C3AED]">
                        {avatarInitial(c.displayName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate font-semibold text-slate-800">{c.displayName}</span>
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {c.time}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="truncate text-xs text-slate-500">{c.preview}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                              SOURCE_BADGE_CLASS[c.sourceKey] || SOURCE_BADGE_CLASS.test_bot
                            }`}
                          >
                            {c.sourceLabel}
                          </span>
                          {c.unread > 0 ? (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#8B5CF6] px-1 text-[10px] font-bold text-white">
                              {c.unread}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {/* Thread */}
        <section
          className={`flex min-h-0 flex-1 flex-col bg-[#FCFAFF]/60 ${
            mobileShowThread ? "flex" : "hidden lg:flex"
          }`}
        >
          {active ? (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b border-[#EEE8FF] bg-white px-3 py-3 lg:px-4">
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
                  <p className="truncate font-semibold text-slate-900">{active.displayName}</p>
                  <p className="truncate text-xs text-slate-400">
                    <span
                      className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        SOURCE_BADGE_CLASS[active.sourceKey] || SOURCE_BADGE_CLASS.test_bot
                      }`}
                    >
                      {active.sourceLabel}
                    </span>
                    · {messages.length} messages
                  </p>
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-[#EEE8FF] bg-[#FDFCFF] px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                  <span>Live Agent</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={liveAgentEnabled}
                    aria-label="Toggle Live Agent mode"
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
                  className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-[#F6F1FF]"
                  aria-label="More"
                >
                  <MoreVertical size={18} />
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
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
                  const isSelf = m.role === "user";
                  const isLiveAgent = m.role === "agent";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                          isSelf
                            ? "rounded-br-md bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] text-white"
                            : isLiveAgent
                            ? "rounded-bl-md border border-emerald-200 bg-emerald-50 text-slate-800"
                            : "rounded-bl-md border border-[#EEE8FF] bg-white text-slate-800"
                        }`}
                      >
                        {!isSelf ? (
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {isLiveAgent ? "Live Agent" : "AI Agent"}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                        {m.role === "assistant" &&
                        Array.isArray(m.attachments) &&
                        m.attachments.length > 0 ? (
                          <AssistantAttachments attachments={m.attachments} />
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

              <footer className="shrink-0 border-t border-[#EEE8FF] bg-white p-3 lg:p-4">
                <div className="flex gap-2 rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-1.5 focus-within:border-[#C4B5FD] focus-within:ring-2 focus-within:ring-[#8B5CF6]/15">
                  <input
                    type="text"
                    value={liveDraft}
                    onChange={(e) => setLiveDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void sendLiveMessage();
                      }
                    }}
                    placeholder={
                      liveAgentEnabled ? "Type as live agent…" : "Enable Live Agent to reply directly…"
                    }
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
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
                    ? "Live Agent mode active: OpenAI replies are paused for this conversation."
                    : "Enable Live Agent to send manual replies from this page."}
                </p>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
              <p className="text-sm font-medium text-slate-500">No conversation selected</p>
              <p className="text-xs">Choose a thread from the list.</p>
            </div>
          )}
        </section>
      </div>
      {error ? (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default Chats;
