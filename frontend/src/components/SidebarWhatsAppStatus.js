import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { getWhatsAppAccountLimit, normalizePlan } from "../planConfig";
import { WhatsAppIcon } from "./WhatsAppIcon";

function accountTitle(account) {
  if (!account) return "WhatsApp";
  const parts = [account.pushname, account.phone].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return account.label || `Account ${account.accountId}`;
}

function accountConnectivity(account) {
  if (account?.connected || account?.phase === "ready") {
    return {
      label: "Connected",
      ring: "ring-emerald-300/80",
      iconColor: "text-[#25D366]",
      iconBg: "bg-emerald-50",
      pulse: false,
    };
  }
  if (["qr", "authenticated", "initializing", "reconnecting"].includes(String(account?.phase || ""))) {
    return {
      label: account?.phase === "reconnecting" ? "Reconnecting…" : "Connecting…",
      ring: "ring-amber-300/80",
      iconColor: "text-amber-500",
      iconBg: "bg-amber-50",
      pulse: true,
    };
  }
  if (account?.phase === "error") {
    return {
      label: "Connection error",
      ring: "ring-red-300/80",
      iconColor: "text-red-500",
      iconBg: "bg-red-50",
      pulse: false,
    };
  }
  if (account?.phase === "disconnected") {
    return {
      label: "Disconnected",
      ring: "ring-orange-300/80",
      iconColor: "text-orange-500",
      iconBg: "bg-orange-50",
      pulse: false,
    };
  }
  return {
    label: "Not linked",
    ring: "ring-slate-200",
    iconColor: "text-slate-400",
    iconBg: "bg-slate-100",
    pulse: false,
  };
}

function SidebarWhatsAppAccountIcon({ account, collapsed }) {
  const status = accountConnectivity(account);
  const title = `${accountTitle(account)} — ${status.label}`;
  const iconSize = collapsed ? 16 : 18;

  return (
    <Link
      to="/integrations"
      title={title}
      aria-label={title}
      className={`group relative flex shrink-0 items-center justify-center rounded-full ring-2 transition hover:scale-105 hover:shadow-md ${status.ring} ${
        collapsed ? "h-9 w-9" : "h-10 w-10"
      }`}
    >
      <span
        className={`flex h-full w-full items-center justify-center rounded-full ${status.iconBg} ${
          status.pulse ? "animate-pulse" : ""
        }`}
      >
        <WhatsAppIcon size={iconSize} className={status.iconColor} />
      </span>
      <span className="absolute -left-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-0.5 text-[9px] font-bold text-slate-600 shadow ring-1 ring-[#EEE8FF]">
        {account.accountId}
      </span>
    </Link>
  );
}

export function SidebarWhatsAppStatus({ collapsed = false }) {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const planLimit = getWhatsAppAccountLimit(normalizePlan(profile?.plan || "") || profile?.plan);
  const [waStatus, setWaStatus] = useState(null);

  useEffect(() => {
    if (!userId) {
      setWaStatus(null);
      return undefined;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`),
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setWaStatus(data);
      } catch {
        if (!cancelled) setWaStatus(null);
      }
    };

    void tick();
    const id = setInterval(() => {
      if (!document.hidden) void tick();
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [userId]);

  const accounts = useMemo(() => {
    if (Array.isArray(waStatus?.accounts) && waStatus.accounts.length) return waStatus.accounts;
    const limit = Number(waStatus?.limit) || planLimit;
    return Array.from({ length: limit }, (_, index) => ({
      accountId: String(index + 1),
      label: `Account ${index + 1}`,
      phase: "idle",
      connected: false,
      persisted: false,
      pushname: "",
      phone: "",
      profilePicDataUrl: "",
    }));
  }, [waStatus, planLimit]);

  if (!userId || accounts.length === 0) return null;

  const connectedCount = accounts.filter((account) => account.connected || account.phase === "ready").length;

  return (
    <div
      className={`mb-6 shrink-0 border-b border-[#EEE8FF] pb-4 ${
        collapsed ? "xl:mb-4 xl:flex xl:flex-col xl:items-center xl:gap-2" : ""
      }`}
    >
      <p
        className={`mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ${
          collapsed ? "xl:sr-only" : ""
        }`}
      >
        WhatsApp accounts
        <span className="ml-1 font-normal normal-case text-slate-400">
          ({connectedCount}/{accounts.length} online)
        </span>
      </p>
      <div
        className={`flex flex-wrap gap-2 ${
          collapsed ? "xl:flex-col xl:items-center xl:gap-2.5" : "items-center"
        }`}
      >
        {accounts.map((account) => (
          <SidebarWhatsAppAccountIcon
            key={account.accountId}
            account={account}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}
