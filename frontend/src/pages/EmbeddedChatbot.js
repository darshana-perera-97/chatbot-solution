import { useEffect, useMemo, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { apiUrl } from "../apiBase";
import { AssistantAttachments } from "../components/AssistantAttachments";

const WIDGET_WIDTH = 380;
const WIDGET_HEIGHT = 640;

const conversationStorageKey = (userId) => `embed_chat_conversation_${userId || "anonymous"}`;

function createConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeConversationId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 120) return "";
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) return "";
  return text;
}

function getOrCreateConversationId(userId) {
  const key = conversationStorageKey(userId);
  const current = sanitizeConversationId(localStorage.getItem(key) || "");
  if (current) return current;
  const next = createConversationId();
  localStorage.setItem(key, next);
  return next;
}

function EmbeddedChatbot() {
  const params = new URLSearchParams(window.location.search || "");
  const userId = String(params.get("userId") || "").trim();
  const previewMode = params.get("previewMode") === "1";
  const previewThemeParam = String(params.get("previewTheme") || "");
  const previewTheme = useMemo(() => {
    if (!previewThemeParam) return null;
    try {
      const parsed = JSON.parse(previewThemeParam);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, [previewThemeParam]);
  const [conversationId, setConversationId] = useState("");
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState({
    primaryColor: "#7C3AED",
    accentColor: "#A78BFA",
    backgroundColor: "#FCFAFF",
    textColor: "#0F172A",
    headerColor: "#7C3AED",
    senderMessageBgColor: "#7C3AED",
    senderMessageTextColor: "#FFFFFF",
    receiverMessageBgColor: "#FFFFFF",
    receiverMessageTextColor: "#1E293B",
    sendButtonColor: "#7C3AED",
  });
  const bottomRef = useRef(null);

  const cssVars = useMemo(
    () => ({
      "--cb-primary": theme.primaryColor,
      "--cb-accent": theme.accentColor,
      "--cb-bg": theme.backgroundColor,
      "--cb-text": theme.textColor,
      "--cb-header": theme.headerColor,
      "--cb-sender-bg": theme.senderMessageBgColor,
      "--cb-sender-text": theme.senderMessageTextColor,
      "--cb-receiver-bg": theme.receiverMessageBgColor,
      "--cb-receiver-text": theme.receiverMessageTextColor,
      "--cb-send-btn": theme.sendButtonColor,
    }),
    [theme]
  );

  useEffect(() => {
    const id = getOrCreateConversationId(userId);
    setConversationId(id);
  }, [userId]);

  useEffect(() => {
    let active = true;
    async function loadTheme() {
      try {
        if (!userId) return;
        const res = await fetch(apiUrl(`/widget-settings?userId=${encodeURIComponent(userId)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        const s = data?.settings || {};
        setTheme((prev) => ({
          ...prev,
          primaryColor: s.primaryColor || prev.primaryColor,
          accentColor: s.accentColor || prev.accentColor,
          backgroundColor: s.backgroundColor || prev.backgroundColor,
          textColor: s.textColor || prev.textColor,
          headerColor: s.headerColor || prev.headerColor,
          senderMessageBgColor: s.senderMessageBgColor || prev.senderMessageBgColor,
          senderMessageTextColor: s.senderMessageTextColor || prev.senderMessageTextColor,
          receiverMessageBgColor: s.receiverMessageBgColor || prev.receiverMessageBgColor,
          receiverMessageTextColor: s.receiverMessageTextColor || prev.receiverMessageTextColor,
          sendButtonColor: s.sendButtonColor || prev.sendButtonColor,
        }));
      } catch {
        // ignore; defaults remain
      }
    }
    loadTheme().finally(() => {
      if (!active || !previewTheme) return;
      setTheme((prev) => ({ ...prev, ...previewTheme }));
    });
    return () => {
      active = false;
    };
  }, [userId, previewTheme]);

  useEffect(() => {
    if (previewMode) {
      setLines([
        { role: "assistant", content: "Hi! I am your AI assistant. This is preview mode." },
        { role: "user", content: "Great, I am checking how the widget looks." },
      ]);
      return;
    }
    let active = true;
    async function loadSession() {
      if (!userId || !conversationId) return;
      try {
        const q = `?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(conversationId)}`;
        const res = await fetch(apiUrl(`/chat/test/session${q}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        const messages = Array.isArray(data?.session?.messages) ? data.session.messages : [];
        const normalized = messages
          .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "agent"))
          .map((m) => ({
            role: m.role,
            content: String(m.content || ""),
            ...(Array.isArray(m.attachments) && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
          }))
          .filter((m) => m.content.trim());
        if (normalized.length > 0) {
          setLines(normalized);
        } else {
          setLines([{ role: "assistant", content: "Hi! How can I help you today?" }]);
        }
      } catch {
        if (!active) return;
        setLines([{ role: "assistant", content: "Hi! How can I help you today?" }]);
      }
    }
    loadSession();
    return () => {
      active = false;
    };
  }, [userId, conversationId, previewMode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, sending]);

  const onSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    if (previewMode) {
      setLines((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      setError("");
      return;
    }
    if (!userId) return;
    const userLine = { role: "user", content: text };
    const next = [...lines, userLine];
    const prev = lines;
    setInput("");
    setError("");
    setLines(next);
    setSending(true);
    try {
      const res = await fetch(apiUrl("/chat/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          conversationId,
          chatSource: "web",
          messages: next,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to send");
      const reply = typeof data.reply === "string" ? data.reply.trim() : "";
      const attachments = Array.isArray(data.attachments) ? data.attachments : [];
      if (reply) {
        setLines([
          ...next,
          {
            role: "assistant",
            content: reply,
            ...(attachments.length > 0 ? { attachments } : {}),
          },
        ]);
      }
    } catch (err) {
      setLines(prev);
      setInput(text);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  };

  const onClose = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "NEXGEN_CHATBOT_CLOSE" }, "*");
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent p-0" style={cssVars}>
      <div className="flex h-full w-full items-end justify-end">
        <main
          className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/30 shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
          style={{
            maxWidth: `${WIDGET_WIDTH}px`,
            maxHeight: `${WIDGET_HEIGHT}px`,
            background: "var(--cb-bg)",
            color: "var(--cb-text)",
          }}
        >
          <header
            className="shrink-0 px-4 py-3 text-white"
            style={{
              background: "var(--cb-header)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold tracking-wide">AI Assistant</p>
                <p className="text-[11px] opacity-85">Premium web chatbot widget</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-white/15 p-1.5 text-white transition hover:bg-white/25"
                aria-label="Close chatbot"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {lines.map((line, idx) => {
              const isUser = line.role === "user";
              return (
                <div key={`${idx}-${line.role}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                      isUser ? "" : "border border-white/70"
                    }`}
                    style={
                      isUser
                        ? { background: "var(--cb-sender-bg)", color: "var(--cb-sender-text)" }
                        : { background: "var(--cb-receiver-bg)", color: "var(--cb-receiver-text)" }
                    }
                  >
                    {!isUser ? (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {line.role === "agent" ? "Live Agent" : "AI Agent"}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap">{line.content}</p>
                    {line.role === "assistant" && Array.isArray(line.attachments) && line.attachments.length > 0 ? (
                      <AssistantAttachments attachments={line.attachments} variant="embed" />
                    ) : null}
                  </div>
                </div>
              );
            })}
            {sending ? <p className="text-xs text-slate-400">Thinking...</p> : null}
            <div ref={bottomRef} />
          </div>

          {error ? <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

          <form onSubmit={onSend} className="shrink-0 border-t border-[#E9DFFF] bg-white p-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] p-1.5">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={(!userId && !previewMode) || sending}
                placeholder={
                  previewMode
                    ? "Type a preview user message..."
                    : userId
                      ? "Type a message..."
                      : "Missing userId in iframe URL"
                }
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-800 outline-none"
              />
              <button
                type="submit"
                disabled={((!userId && !previewMode) || sending || !input.trim())}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--cb-send-btn)" }}
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

export default EmbeddedChatbot;
