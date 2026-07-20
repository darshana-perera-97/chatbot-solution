import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, MessageCircle, Plus, RefreshCw, X } from "lucide-react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import {
  fetchWhatsAppStatus,
  restorePersistedWhatsAppAccounts,
} from "../hooks/useWhatsAppStatus";
import { getWhatsAppAccountLimit, normalizePlan } from "../planConfig";

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
    description: "Link one or more WhatsApp numbers to this workspace. Limits depend on your plan.",
    status: "available",
    statusLabel: "Not connected",
    icon: MessageCircle,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-700",
    accent: "from-emerald-600 to-emerald-500",
  },
];

function accountLabel(account) {
  if (!account) return "";
  const parts = [account.pushname, account.phone].filter(Boolean);
  return parts.length ? parts.join(" · ") : account.label || `Account ${account.accountId}`;
}

function WhatsAppAccountAvatar({ account, size = "lg" }) {
  const sizeClass = size === "sm" ? "h-10 w-10" : "h-20 w-20";
  const iconSize = size === "sm" ? 18 : 32;
  const pic = typeof account?.profilePicDataUrl === "string" ? account.profilePicDataUrl : "";
  if (pic) {
    return (
      <img
        src={pic}
        alt={accountLabel(account)}
        className={`${sizeClass} rounded-full border-2 border-white object-cover shadow-md ring-2 ring-[#E9DFFF]`}
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClass} items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-2 ring-[#E9DFFF]`}
    >
      <MessageCircle size={iconSize} />
    </div>
  );
}

function Integrations() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const userPlan = normalizePlan(profile?.plan || "");
  const planLimit = getWhatsAppAccountLimit(userPlan || profile?.plan);
  const [showWebConfig, setShowWebConfig] = useState(false);
  const [showWhatsAppConfig, setShowWhatsAppConfig] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState("1");
  const [copiedType, setCopiedType] = useState("");
  const [waStatus, setWaStatus] = useState(null);
  const [waModalError, setWaModalError] = useState("");
  const [waRefreshing, setWaRefreshing] = useState(false);
  const [waSyncing, setWaSyncing] = useState(false);
  const [waSyncMessage, setWaSyncMessage] = useState("");
  const syncedAccountsRef = useRef(new Set());
  const restoreAttemptTimesRef = useRef(new Map());

  const waAccounts = useMemo(() => {
    if (Array.isArray(waStatus?.accounts) && waStatus.accounts.length) return waStatus.accounts;
    const fallbackLimit = Number(waStatus?.limit) || planLimit;
    return Array.from({ length: fallbackLimit }, (_, index) => ({
      accountId: String(index + 1),
      label: `Account ${index + 1}`,
      phase: "idle",
      connected: false,
      qrDataUrl: "",
      error: "",
      pushname: "",
      phone: "",
    }));
  }, [waStatus, planLimit]);

  const waLimit = Number(waStatus?.limit) || planLimit;
  const waConnectedCount =
    Number(waStatus?.connectedCount) ||
    waAccounts.filter((account) => account.connected || account.phase === "ready").length;
  const waReconnecting = waAccounts.some(
    (account) => account.persisted && !account.connected && account.phase !== "ready"
  );
  const activeAccount =
    waAccounts.find((account) => account.accountId === activeAccountId) || waAccounts[0] || null;

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
    return fetchWhatsAppStatus(userId);
  };

  const refreshOrRetryWhatsApp = async ({ openModal = false, accountId = activeAccountId } = {}) => {
    if (openModal) setShowWhatsAppConfig(true);
    if (accountId) setActiveAccountId(String(accountId));
    setWaModalError("");
    if (!userId) {
      setWaModalError("Sign in to connect WhatsApp.");
      return;
    }

    setWaRefreshing(true);
    try {
      const st = await fetchWaStatus();
      setWaStatus(st);

      const accounts = Array.isArray(st?.accounts) ? st.accounts : [];
      const target =
        accounts.find((account) => account.accountId === String(accountId)) ||
        accounts.find((account) => !account.connected) ||
        accounts[0];
      const targetId = target?.accountId || String(accountId || "1");
      const phase = typeof target?.phase === "string" ? target.phase : "";
      const shouldRestorePersisted =
        Boolean(target?.persisted) &&
        !target?.connected &&
        target?.phase !== "ready" &&
        !["qr", "authenticated", "initializing"].includes(phase);
      const shouldStartFresh =
        !target?.persisted &&
        !["ready", "qr", "authenticated", "initializing", "reconnecting"].includes(phase);
      if (shouldRestorePersisted || shouldStartFresh) {
        const startRes = await fetch(apiUrl("/integrations/whatsapp/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, accountId: targetId }),
        });
        const body = await startRes.json().catch(() => ({}));
        if (!startRes.ok) throw new Error(body.message || "Could not start WhatsApp client");
        setWaStatus(body);
        setActiveAccountId(targetId);
      }
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setWaRefreshing(false);
    }
  };

  const startAccountLinking = async (accountId) => {
    if (!userId) return;
    setActiveAccountId(String(accountId));
    setWaModalError("");
    setWaRefreshing(true);
    try {
      const startRes = await fetch(apiUrl("/integrations/whatsapp/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accountId: String(accountId) }),
      });
      const body = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(body.message || "Could not start WhatsApp client");
      setWaStatus(body);
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setWaRefreshing(false);
    }
  };

  const regenerateQr = async (accountId = activeAccountId) => {
    if (!userId) return;
    setActiveAccountId(String(accountId));
    setWaModalError("");
    setWaRefreshing(true);
    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/regenerate-qr"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accountId: String(accountId) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not regenerate QR code");
      setWaStatus(body);
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setWaRefreshing(false);
    }
  };

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        let data = await fetchWaStatus();
        if (!cancelled && data) {
          data = await restorePersistedWhatsAppAccounts(userId, data, restoreAttemptTimesRef.current);
          setWaStatus(data);
        }
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

  useEffect(() => {
    if (!userId || !waStatus) return;
    const accounts = Array.isArray(waStatus.accounts) ? waStatus.accounts : [];
    accounts.forEach((account) => {
      const accountId = String(account.accountId || "1");
      const connected = Boolean(account.connected || account.phase === "ready");
      if (!connected) {
        syncedAccountsRef.current.delete(accountId);
        return;
      }
      if (syncedAccountsRef.current.has(accountId)) return;
      syncedAccountsRef.current.add(accountId);
      void syncConversations(accountId, { silent: true });
    });
  }, [userId, waStatus]);

  const openWhatsAppModal = async () => {
    const firstOpenSlot =
      waAccounts.find((account) => !account.connected && account.phase !== "ready")?.accountId || "1";
    await refreshOrRetryWhatsApp({ openModal: true, accountId: firstOpenSlot });
  };

  const disconnectWhatsApp = async (accountId = activeAccountId) => {
    if (!userId) return;
    const targetId = String(accountId);
    setActiveAccountId(targetId);
    setWaModalError("");
    setWaRefreshing(true);
    // Hide "Restoring…" copy immediately and clear local session flags for this slot.
    setWaStatus((prev) => {
      if (!prev || !Array.isArray(prev.accounts)) return prev;
      return {
        ...prev,
        accounts: prev.accounts.map((account) =>
          String(account.accountId) === targetId
            ? {
                ...account,
                connected: false,
                persisted: false,
                phase: "initializing",
                qrDataUrl: "",
                error: "",
                pushname: "",
                phone: "",
                profilePicDataUrl: "",
              }
            : account
        ),
      };
    });
    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/disconnect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accountId: targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Disconnect failed");
      syncedAccountsRef.current.delete(targetId);
      setWaStatus(data);

      // Start a fresh link so the QR for a new device appears right away.
      const startRes = await fetch(apiUrl("/integrations/whatsapp/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accountId: targetId }),
      });
      const body = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(body.message || "Could not start WhatsApp client");
      setWaStatus(body);
    } catch (e) {
      setWaModalError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setWaRefreshing(false);
    }
  };

  const syncConversations = async (accountId = activeAccountId, { silent = false } = {}) => {
    if (!userId) return null;
    if (!silent) {
      setWaModalError("");
      setWaSyncMessage("");
    }
    setWaSyncing(true);
    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/sync-conversations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          accountId: accountId != null ? String(accountId) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not sync WhatsApp conversations");
      if (data && typeof data === "object") setWaStatus(data);
      const summary =
        typeof data.message === "string"
          ? data.message
          : `Synced (${Number(data.created) || 0} new, ${Number(data.updated) || 0} updated)`;
      if (!silent) setWaSyncMessage(summary);
      return data;
    } catch (e) {
      if (!silent) {
        setWaModalError(e instanceof Error ? e.message : "Sync failed");
      }
      return null;
    } finally {
      setWaSyncing(false);
    }
  };

  const waConnected = waConnectedCount > 0;
  const activeConnected = Boolean(activeAccount?.connected || activeAccount?.phase === "ready");
  const activePhase = typeof activeAccount?.phase === "string" ? activeAccount.phase : "";
  const activeAccountLabel = accountLabel(activeAccount) || "Connected";
  const canRegenerateQr =
    !activeConnected &&
    ["qr", "initializing", "authenticated", "error"].includes(activePhase);
  const isRestoringSession =
    !activeConnected &&
    (activePhase === "reconnecting" || Boolean(activeAccount?.persisted));

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
                ? `${waConnectedCount} connected`
                : waReconnecting
                  ? "Reconnecting…"
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
                {isWa ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="rounded-lg border border-[#EEE8FF] bg-[#FCFAFF] px-2.5 py-1.5 text-xs text-slate-600">
                      Plan: <span className="font-semibold text-slate-800">{userPlan || "—"}</span> · up to{" "}
                      <span className="font-semibold text-slate-800">{waLimit}</span> WhatsApp account
                      {waLimit === 1 ? "" : "s"}
                    </p>
                    {waAccounts
                      .filter((account) => account.connected || account.phase === "ready")
                      .map((account) => (
                        <div
                          key={account.accountId}
                          className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5"
                        >
                          <WhatsAppAccountAvatar account={account} size="sm" />
                          <p className="min-w-0 text-xs font-medium text-emerald-800">
                            <span className="font-semibold">{account.label}:</span> {accountLabel(account)}
                          </p>
                        </div>
                      ))}
                  </div>
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
                    {isConnected ? "Manage accounts" : "Connect"}
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
          <div className="w-full max-w-3xl rounded-3xl border border-[#E9DFFF] bg-gradient-to-b from-white to-[#FCFAFF] p-5 shadow-[0_30px_80px_rgba(15,23,42,0.3)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-900">WhatsApp accounts</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Link up to {waLimit} WhatsApp number{waLimit === 1 ? "" : "s"} on your {userPlan || "current"}{" "}
                  plan. Scan each QR with WhatsApp → Linked devices.
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
            {waSyncMessage ? (
              <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {waSyncMessage}
              </p>
            ) : null}

            {waStatus?.available === false ? (
              <p className="mt-3 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-2 text-sm text-[#6D28D9]">
                WhatsApp integration is not available on this server (install backend dependencies and restart).
              </p>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your slots</p>
                {waAccounts.map((account) => {
                  const connected = Boolean(account.connected || account.phase === "ready");
                  const isActive = account.accountId === activeAccountId;
                  return (
                    <div
                      key={account.accountId}
                      className={`rounded-xl border p-3 transition ${
                        isActive
                          ? "border-[#C4B5FD] bg-[#F8F5FF] shadow-sm"
                          : "border-[#E9DFFF] bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveAccountId(account.accountId)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          {connected ? <WhatsAppAccountAvatar account={account} size="sm" /> : null}
                          <span className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{account.label}</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {connected
                                ? accountLabel(account)
                                : account.phase === "reconnecting"
                                  ? "Restoring session…"
                                  : account.phase === "qr"
                                    ? "Waiting for scan"
                                    : account.phase === "initializing" || account.phase === "authenticated"
                                      ? "Connecting…"
                                      : "Not linked"}
                            </p>
                          </span>
                        </button>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            connected
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {connected ? "Connected" : account.phase || "idle"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!connected && !account.persisted ? (
                          <button
                            type="button"
                            onClick={() => void startAccountLinking(account.accountId)}
                            disabled={waRefreshing}
                            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            <Plus size={14} />
                            Link
                          </button>
                        ) : !connected && account.persisted ? (
                          <>
                            <span className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1.5 text-xs font-medium text-[#6D28D9]">
                              <RefreshCw size={12} className="animate-spin" />
                              Restoring…
                            </span>
                            <button
                              type="button"
                              onClick={() => void disconnectWhatsApp(account.accountId)}
                              className="rounded-lg border border-[#E9DFFF] bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Clear
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void disconnectWhatsApp(account.accountId)}
                            className="rounded-lg border border-[#E9DFFF] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-slate-800">{activePhase || "—"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E9DFFF] bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Session</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {activeConnected
                        ? activeAccountLabel
                        : isRestoringSession
                          ? "Restoring…"
                          : activePhase === "initializing" ||
                              activePhase === "authenticated" ||
                              activePhase === "qr"
                            ? "Linking…"
                            : "Not linked"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-[#E9DFFF] bg-[#FCFAFF] p-4 shadow-inner">
                  {activeAccount?.qrDataUrl && !activeConnected ? (
                    <>
                      <img
                        src={activeAccount.qrDataUrl}
                        alt="WhatsApp QR code"
                        className="h-56 w-56 rounded-xl border border-[#E9DFFF] bg-white p-2 shadow-sm"
                      />
                      <p className="mt-3 text-center text-xs text-slate-500">
                        QR codes expire after a short time. Regenerate if scan fails.
                      </p>
                    </>
                  ) : null}
                  {activeConnected ? (
                    <div className="text-center">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Connected account
                      </p>
                      <div className="mx-auto mt-3 flex justify-center">
                        <WhatsAppAccountAvatar account={activeAccount} />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-[#6D28D9]">{activeAccountLabel}</p>
                    </div>
                  ) : null}
                  {!activeAccount?.qrDataUrl && !activeConnected && activePhase !== "error" ? (
                    <div className="text-center">
                      {activePhase === "reconnecting" || activeAccount?.persisted ? (
                        <>
                          <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-slate-400" />
                          <p className="text-sm text-slate-500">
                            Restoring your saved WhatsApp session. This can take up to a minute.
                          </p>
                          <p className="mt-2 text-xs text-slate-400">
                            If this takes too long, the saved session may be stale. Click{" "}
                            <button
                              type="button"
                              onClick={() => void disconnectWhatsApp(activeAccountId)}
                              className="inline font-semibold text-[#6D28D9] underline underline-offset-2 hover:text-[#5B21B6]"
                            >
                              Disconnect
                            </button>{" "}
                            to clear it and link a fresh account.
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">
                          {activePhase === "initializing" || activePhase === "authenticated"
                            ? "Starting browser session…"
                            : "Select a slot and tap Link to show a QR code."}
                        </p>
                      )}
                    </div>
                  ) : null}
                  {activePhase === "error" ? (
                    <p className="text-center text-sm text-red-700">{activeAccount?.error || "WhatsApp error"}</p>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {activeConnected ? (
                    <button
                      type="button"
                      onClick={() => void syncConversations(activeAccountId)}
                      disabled={waSyncing || waRefreshing}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 disabled:opacity-60"
                    >
                      <RefreshCw size={16} className={waSyncing ? "animate-spin" : ""} />
                      {waSyncing ? "Syncing chats…" : "Sync conversations"}
                    </button>
                  ) : null}
                  {canRegenerateQr ? (
                    <button
                      type="button"
                      onClick={() => void regenerateQr(activeAccountId)}
                      disabled={waRefreshing}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#FCFAFF]"
                    >
                      <RefreshCw size={16} className={waRefreshing ? "animate-spin" : ""} />
                      {waRefreshing ? "Regenerating…" : "Regenerate QR"}
                    </button>
                  ) : null}
                  {isRestoringSession ? (
                    <button
                      type="button"
                      onClick={() => void disconnectWhatsApp(activeAccountId)}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-[#FCFAFF]"
                    >
                      Disconnect
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void refreshOrRetryWhatsApp({ accountId: activeAccountId })}
                    disabled={waRefreshing}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
                  >
                    {waRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Integrations;
