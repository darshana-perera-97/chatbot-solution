import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { AssistantAttachments } from "../components/AssistantAttachments";

const conversationStorageKey = (userId) =>
  `workspace_testbot_conversation_id_${userId || "anonymous"}`;

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
  const existing = sanitizeConversationId(localStorage.getItem(key) || "");
  if (existing) return existing;
  const generated = createConversationId();
  localStorage.setItem(key, generated);
  return generated;
}

/** First line / title-ish text from company details for "of …" in the greeting. */
function companyInstituteDisplayName(companyDetails) {
  const c = typeof companyDetails === "string" ? companyDetails.trim() : "";
  if (!c) return "";
  const firstLine = c.split(/\r?\n/)[0].trim();
  const beforeLongDash = firstLine.split(/\s[—–]\s/)[0]?.trim() || firstLine;
  const name = beforeLongDash.length > 100 ? `${beforeLongDash.slice(0, 97)}…` : beforeLongDash;
  return name;
}

/** Short opener from agent role (first sentence or first line). */
function agentRoleTeaser(basicDetails, maxLen = 140) {
  const b = typeof basicDetails === "string" ? basicDetails.trim() : "";
  if (!b) return "";
  const line = b.split(/\r?\n/)[0].trim();
  const match = line.match(/^.{1,400}?[.!?](\s|$)/);
  const sentence = match ? match[0].trim() : line;
  return sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1)}…` : sentence;
}

function TestBot() {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [agentBasic, setAgentBasic] = useState("");
  const [agentCompany, setAgentCompany] = useState("");
  const [agentProfileLoading, setAgentProfileLoading] = useState(true);
  const [conversationId, setConversationId] = useState("");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [collectedData, setCollectedData] = useState({});
  const bottomRef = useRef(null);

  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";

  const greetingText = useMemo(() => {
    if (agentProfileLoading) return "";
    const org = companyInstituteDisplayName(agentCompany);
    const roleLine = agentRoleTeaser(agentBasic, 160);
    if (org) {
      const middle = roleLine ? ` ${roleLine}` : "";
      return `Hi, I'm an AI agent of ${org}.${middle} How can I help you today?`;
    }
    if (roleLine) {
      return `Hi, I'm your AI agent. ${roleLine} How can I help you today?`;
    }
    return "Hi, I'm your AI agent. How can I help you today?";
  }, [agentProfileLoading, agentCompany, agentBasic]);

  useEffect(() => {
    const nextId = getOrCreateConversationId(userId);
    setConversationId(nextId);
  }, [userId]);

  useEffect(() => {
    setLines([]);
    let active = true;
    async function loadAgentProfile() {
      setAgentProfileLoading(true);
      try {
        const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
        const res = await fetch(apiUrl(`/agent-details${query}`));
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        const d = data.details || {};
        setAgentBasic(typeof d.basicDetails === "string" ? d.basicDetails.trim() : "");
        setAgentCompany(typeof d.companyDetails === "string" ? d.companyDetails.trim() : "");
      } catch {
        if (active) {
          setAgentBasic("");
          setAgentCompany("");
        }
      } finally {
        if (active) setAgentProfileLoading(false);
      }
    }
    loadAgentProfile();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (agentProfileLoading || !conversationId) return undefined;
    async function loadPreviousSession() {
      setSessionLoading(true);
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setLines(greetingText ? [{ role: "assistant", content: greetingText }] : []);
          return;
        }
        const query = `?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(
          conversationId
        )}`;
        const res = await fetch(apiUrl(`/chat/test/session${query}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Could not load previous session");
        }
        if (!active) return;
        const savedMessages = Array.isArray(data?.session?.messages) ? data.session.messages : [];
        const leadCollected =
          data?.lead?.collectedData && typeof data.lead.collectedData === "object"
            ? data.lead.collectedData
            : {};
        setCollectedData(leadCollected);
        const normalized = savedMessages
          .filter((line) => line && (line.role === "assistant" || line.role === "user" || line.role === "agent"))
          .map((line) => ({
            role: line.role,
            content: typeof line.content === "string" ? line.content : "",
            ...(Array.isArray(line.attachments) && line.attachments.length > 0
              ? { attachments: line.attachments }
              : {}),
          }))
          .filter((line) => line.content.trim().length > 0);

        if (normalized.length > 0) {
          setLines(normalized);
        } else {
          setLines(greetingText ? [{ role: "assistant", content: greetingText }] : []);
        }
      } catch (err) {
        if (!active) return;
        setLines(greetingText ? [{ role: "assistant", content: greetingText }] : []);
        setError(err instanceof Error ? err.message : "Could not load previous session");
      } finally {
        if (active) setSessionLoading(false);
      }
    }
    loadPreviousSession();
    return () => {
      active = false;
    };
  }, [agentProfileLoading, conversationId, userId, greetingText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, sending]);

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userLine = { role: "user", content: text };
    const next = [...lines, userLine];
    const previous = lines;

    setInput("");
    setError("");
    setLines(next);
    setSending(true);

    try {
      const activeConversationId = conversationId || getOrCreateConversationId(userId);
      if (!conversationId) setConversationId(activeConversationId);
      const res = await fetch(apiUrl("/chat/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(userId ? { userId } : {}),
          conversationId: activeConversationId,
          chatSource: "test_bot",
          messages: next,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Could not get a reply");
      }
      const reply = typeof data.reply === "string" ? data.reply.trim() : "";
      const nextCollected =
        data?.collectedData && typeof data.collectedData === "object" ? data.collectedData : null;
      if (nextCollected) {
        setCollectedData(nextCollected);
      }
      if (!reply) {
        if (data.liveAgentEnabled || data.aiRepliesDisabled) {
          return;
        }
        throw new Error("Empty reply from server");
      }
      const attachments = Array.isArray(data.attachments) ? data.attachments : [];
      setLines([
        ...next,
        {
          role: "assistant",
          content: reply,
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      ]);
    } catch (err) {
      setLines(previous);
      setInput(text);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    const nextConversationId = createConversationId();
    localStorage.setItem(conversationStorageKey(userId), nextConversationId);
    setConversationId(nextConversationId);
    setError("");
    setInput("");
    setCollectedData({});
    setLines(greetingText ? [{ role: "assistant", content: greetingText }] : []);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[#F0E9FF] bg-white shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="shrink-0 border-b border-[#F0E9FF] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Test Bot</h1>
          </div>
          <button
            type="button"
            onClick={clearChat}
            disabled={lines.length === 0 && !input}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#F6F1FF] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            Clear chat
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FCFAFF] px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-4">
          {Object.keys(collectedData).length > 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Collected Data
              </p>
              <div className="mt-2 space-y-1.5">
                {Object.entries(collectedData).map(([key, value]) => (
                  <p key={key} className="text-sm text-slate-700">
                    <span className="font-semibold">{key}:</span> {String(value)}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {(agentProfileLoading || sessionLoading) && lines.length === 0 ? (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-[#EEE8FF] bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                Loading…
              </div>
            </div>
          ) : null}

          {lines.map((line, idx) => (
            <div
              key={`${idx}-${line.role}-${line.content.slice(0, 24)}`}
              className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  line.role === "user"
                    ? "rounded-br-md bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] text-white"
                    : line.role === "agent"
                    ? "rounded-bl-md border border-emerald-200 bg-emerald-50 text-slate-800"
                    : "rounded-bl-md border border-[#EEE8FF] bg-white text-slate-800"
                }`}
              >
                {line.role !== "user" ? (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {line.role === "agent" ? "Live Agent" : "AI Agent"}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap">{line.content}</p>
                {line.role === "assistant" && Array.isArray(line.attachments) && line.attachments.length > 0 ? (
                  <AssistantAttachments attachments={line.attachments} />
                ) : null}
              </div>
            </div>
          ))}

          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-[#EEE8FF] bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                Thinking…
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-t border-red-100 bg-red-50 px-6 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <form
        onSubmit={sendMessage}
        className="shrink-0 border-t border-[#F0E9FF] bg-white p-4 md:px-6 md:py-4"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            disabled={sending}
            className="min-w-0 flex-1 rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 disabled:opacity-60"
            maxLength={4000}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-5 py-3 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </form>
    </main>
  );
}

export default TestBot;
