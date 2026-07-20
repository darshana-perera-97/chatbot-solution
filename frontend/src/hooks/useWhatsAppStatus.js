import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { getWhatsAppAccountLimit, normalizePlan } from "../planConfig";

export function accountNeedsWhatsAppRestore(account) {
  if (!account?.persisted) return false;
  if (account.connected || account.phase === "ready") return false;
  const phase = String(account.phase || "");
  if (["qr", "initializing", "authenticated"].includes(phase)) return false;
  return true;
}

export async function fetchWhatsAppStatus(userId) {
  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  if (!safeUserId) return null;
  const res = await fetch(apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(safeUserId)}`), {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not load WhatsApp status");
  return data;
}

export async function restorePersistedWhatsAppAccounts(userId, status, attempted = new Set()) {
  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  if (!safeUserId || !status) return status;

  const accounts = Array.isArray(status.accounts) ? status.accounts : [];
  let latestStatus = status;

  for (const account of accounts) {
    const accountId = String(account.accountId || "1");
    if (!accountNeedsWhatsAppRestore(account)) continue;
    if (attempted.has(accountId)) continue;
    attempted.add(accountId);

    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: safeUserId, accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && typeof data === "object") {
        latestStatus = data;
      } else {
        attempted.delete(accountId);
      }
    } catch {
      attempted.delete(accountId);
    }
  }

  return latestStatus;
}

export function useWhatsAppStatus({ pollIntervalMs = 8000, autoRestore = false } = {}) {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const planLimit = getWhatsAppAccountLimit(normalizePlan(profile?.plan || "") || profile?.plan);
  const [waStatus, setWaStatus] = useState(null);
  const restoreAttemptedRef = useRef(new Set());

  const refreshStatus = useCallback(async () => {
    if (!userId) return null;
    const data = await fetchWhatsAppStatus(userId);
    setWaStatus(data);
    return data;
  }, [userId]);

  const restorePersisted = useCallback(async () => {
    if (!userId) return null;
    try {
      const current =
        waStatus && typeof waStatus === "object"
          ? waStatus
          : await fetchWhatsAppStatus(userId);
      if (!current) return null;
      const next = await restorePersistedWhatsAppAccounts(userId, current, restoreAttemptedRef.current);
      setWaStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [userId, waStatus]);

  useEffect(() => {
    if (!userId) {
      setWaStatus(null);
      restoreAttemptedRef.current.clear();
      return undefined;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        let data = await fetchWhatsAppStatus(userId);
        if (cancelled || !data) return;
        if (autoRestore) {
          data = await restorePersistedWhatsAppAccounts(userId, data, restoreAttemptedRef.current);
        }
        if (!cancelled) setWaStatus(data);
      } catch {
        if (!cancelled) setWaStatus(null);
      }
    };

    void tick();
    const id = setInterval(() => {
      if (!document.hidden) void tick();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [userId, pollIntervalMs, autoRestore]);

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

  const connectedCount =
    Number(waStatus?.connectedCount) ||
    accounts.filter((account) => account.connected || account.phase === "ready").length;

  return {
    userId,
    waStatus,
    accounts,
    connectedCount,
    refreshStatus,
    restorePersisted,
  };
}
