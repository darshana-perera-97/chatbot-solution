import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Globe, MessageCircle, X } from "lucide-react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";

/** Channel integrations — extend this list as you add more. */
const integrationCards = [
  {
    id: "web",
    name: "Web",
    description: "Embed the chat widget on your site to capture visitors and answer FAQs in real time.",
    status: "connected",
    statusLabel: "Connected",
    icon: Globe,
    iconBg: "bg-[#F4ECFF]",
    iconColor: "text-[#7C3AED]",
    accent: "from-[#8B5CF6] to-[#A78BFA]",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Link WhatsApp Web to this workspace: same AI replies as the web widget, chats show under Chats.",
    status: "available",
    statusLabel: "Not connected",
    icon: MessageCircle,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-700",
    accent: "from-emerald-600 to-emerald-500",
  },
];

function Integrations() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const [showWebConfig, setShowWebConfig] = useState(false);
  const [showWhatsAppConfig, setShowWhatsAppConfig] = useState(false);
  const [copiedType, setCopiedType] = useState("");
  const [waStatus, setWaStatus] = useState(null);
  const [waModalError, setWaModalError] = useState("");

  const embedScriptSrc = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/chatbot-embed.js`;
  }, [userId]);
  const embedApiBase = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      return new URL(apiUrl("/widget-settings"), window.location.origin).origin;
    } catch {
      return "";
    }
  }, []);

  const embedCode = `<script src="${embedScriptSrc}" data-user-id="${userId}"${
    embedApiBase ? ` data-api-base="${embedApiBase}"` : ""
  } defer></script>`;

  const copyText = async (text, type) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopiedType(type);
      setTimeout(() => {
        setCopiedType((current) => (current === type ? "" : current));
      }, 1400);
    } catch {
      setCopiedType("");
    }
  };

  const fetchWaStatus = async () => {
    if (!userId) return null;
    const res = await fetch(apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Could not load WhatsApp status");
    return data;
  };

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchWaStatus();
        if (!cancelled && data) setWaStatus(data);
      } catch {
        if (!cancelled) setWaStatus(null);
      }
    };
    void tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [userId]);

  useEffect(() => {
    if (!showWhatsAppConfig || !userId) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchWaStatus();
        if (!cancelled && data) setWaStatus(data);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showWhatsAppConfig, userId]);

  const openWhatsAppModal = async () => {
    setShowWhatsAppConfig(true);
    setWaModalError("");
    if (!userId) {
      setWaModalError("Sign in to connect WhatsApp.");
      return;
    }
    try {
      const st = await fetchWaStatus();
      setWaStatus(st);
      const phase = typeof st?.phase === "string" ? st.phase : "";
      const busy = ["ready", "qr", "authenticated", "initializing"].includes(phase);
      if (!busy) {
        const startRes = await fetch(apiUrl("/integrations/whatsapp/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const body = await startRes.json().catch(() => ({}));
        if (!startRes.ok) throw new Error(body.message || "Could not start WhatsApp client");
        setWaStatus(body);
      }
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const disconnectWhatsApp = async () => {
    if (!userId) return;
    setWaModalError("");
    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/disconnect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Disconnect failed");
      setWaStatus(data);
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const waConnected = Boolean(waStatus?.connected || waStatus?.phase === "ready");
  const waPhase = typeof waStatus?.phase === "string" ? waStatus.phase : "";
  const waConnectedAccountLabel =
    [waStatus?.pushname, waStatus?.phone].filter(Boolean).join(" · ") || "Connected";

  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
        <header className="mb-8 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Integrations</h1>
          <p className="mt-2 text-sm text-slate-400">
            Connect channels where your AI agent can talk to customers. More integrations will appear here as
            they are enabled.
          </p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-2 xl:max-w-4xl">
          {integrationCards.map((item) => {
            const Icon = item.icon;
            const isWeb = item.id === "web";
            const isWa = item.id === "whatsapp";
            const isConnected = isWeb ? item.status === "connected" : waConnected;
            const statusLabel = isWa
              ? waConnected
                ? "Connected"
                : "Not connected"
              : item.statusLabel;
            return (
              <article
                key={item.id}
                className="group flex flex-col rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#E4D4FF] hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${item.iconBg} ${item.iconColor}`}
                  >
                    <Icon size={22} strokeWidth={2} />
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      isConnected
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80"
                        : "bg-slate-100 text-slate-500 ring-1 ring-slate-200/80"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>

                <h2 className="mt-4 text-lg font-semibold text-slate-900">{item.name}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{item.description}</p>
                {isWa && waConnected ? (
                  <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
                    Connected account: {waConnectedAccountLabel}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#EEE8FF] pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (isWeb) setShowWebConfig(true);
                      if (isWa) void openWhatsAppModal();
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95 ${
                      isConnected
                        ? "bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] shadow-[#8B5CF6]/30"
                        : `bg-gradient-to-r ${item.accent} shadow-emerald-900/10`
                    }`}
                  >
                    {isConnected ? "Configure" : "Connect"}
                    <ArrowRight size={16} className="opacity-90" />
                  </button>
                  <button
                    type="button"
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-white"
                  >
                    Learn more
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {showWebConfig ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-[#E9DFFF] bg-gradient-to-b from-white to-[#FCFAFF] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.3)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-900">Web embed code</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Paste this script tag in your website. The chatbot bubble will render fixed at the bottom-right.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWebConfig(false)}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-[#F6F1FF]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Placement</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">Bottom-right</p>
              </div>
              <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">Script embed</p>
              </div>
              <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
                <p className="mt-1 text-sm font-semibold text-emerald-700">Ready to embed</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Embed script snippet</p>
                <button
                  type="button"
                  onClick={() => void copyText(embedCode, "code")}
                  className="rounded-lg border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1.5 text-xs font-semibold text-[#6D28D9] transition hover:bg-[#F2EBFF]"
                >
                  {copiedType === "code" ? "Copied" : "Copy code"}
                </button>
              </div>
              <textarea
                readOnly
                value={embedCode}
                className="h-32 w-full rounded-xl border border-[#E9DFFF] bg-[#FCFAFF] p-3 font-mono text-xs text-slate-700"
              />
            </div>
          </div>
        </div>
      ) : null}

      {showWhatsAppConfig ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-[#E9DFFF] bg-gradient-to-b from-white to-[#FCFAFF] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.3)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-900">WhatsApp connection</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Scan the QR code with WhatsApp on your phone (Linked devices). Messages use the same AI settings as
                  your web chat; conversations appear on the Chats page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatsAppConfig(false)}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-[#F6F1FF]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {waModalError ? (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {waModalError}
              </p>
            ) : null}

            {waStatus?.available === false ? (
              <p className="mt-3 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-2 text-sm text-[#6D28D9]">
                WhatsApp integration is not available on this server (install backend dependencies and restart).
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
                <p className="mt-1 text-sm font-semibold capitalize text-slate-800">{waPhase || "—"}</p>
              </div>
              <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Session</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {waConnected ? waConnectedAccountLabel : "Not linked"}
                </p>
              </div>
            </div>

            <div className="mt-4 flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-[#E9DFFF] bg-[#FCFAFF] p-4 shadow-inner">
              {waStatus?.qrDataUrl && !waConnected ? (
                <img
                  src={waStatus.qrDataUrl}
                  alt="WhatsApp QR code"
                  className="h-56 w-56 rounded-xl border border-[#E9DFFF] bg-white p-2 shadow-sm"
                />
              ) : null}
              {waConnected ? (
                <div className="text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Connected account
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#6D28D9]">{waConnectedAccountLabel}</p>
                </div>
              ) : null}
              {!waStatus?.qrDataUrl && !waConnected && waPhase !== "error" ? (
                <p className="text-center text-sm text-slate-500">
                  {waPhase === "initializing" || waPhase === "authenticated"
                    ? "Starting browser session…"
                    : "Waiting for QR code from server…"}
                </p>
              ) : null}
              {waPhase === "error" ? (
                <p className="text-center text-sm text-red-700">{waStatus?.error || "WhatsApp error"}</p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void openWhatsAppModal()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
              >
                Refresh / retry start
              </button>
              <button
                type="button"
                onClick={() => void disconnectWhatsApp()}
                className="rounded-xl border border-[#E9DFFF] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#FCFAFF]"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Integrations;
