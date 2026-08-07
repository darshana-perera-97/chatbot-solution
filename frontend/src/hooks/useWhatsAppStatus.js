import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import { getWhatsAppAccountLimit, normalizePlan } from "../planConfig";

/** Minimum wait before retrying restore for the same account slot. */
export const WHATSAPP_RESTORE_RETRY_MS = 8000;

export function accountNeedsWhatsAppRestore(account) {
  if (!account?.persisted) return false;
  if (account.connected || account.phase === "ready") return false;
  const phase = String(account.phase || "");
  if (["qr", "initializing", "authenticated"].includes(phase)) return false;
  return true;
}

export function statusHasAccountsNeedingRestore(status) {
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  return accounts.some((account) => accountNeedsWhatsAppRestore(account));
}

export async function fetchWhatsAppStatus(userId) {
  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  if (!safeUserId) return null;
  const res = await fetch(apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`), {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not load WhatsApp status");
  return data;
}

/**
 * Ask the server to restore every persisted account that is not online yet.
 * Retries on a timer — linked accounts should stay connected even after tab closes.
 */
export async function restorePersistedWhatsAppAccounts(
  userId,
  status,
  lastAttempts = new Map(),
  { retryMs = WHATSAPP_RESTORE_RETRY_MS } = {}
) {
  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  if (!safeUserId || !status) return status;

  const accounts = Array.isArray(status.accounts) ? status.accounts : [];
  let latestStatus = status;
  const now = Date.now();

  for (const account of accounts) {
    const accountId = String(account.accountId || "1");

    if (!accountNeedsWhatsAppRestore(account)) {
      lastAttempts.delete(accountId);
      continue;
    }

    const lastAt = lastAttempts.get(accountId) || 0;
    if (now - lastAt < retryMs) continue;
    lastAttempts.set(accountId, now);

    try {
      const res = await fetch(apiUrl("/integrations/whatsapp/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: safeUserId, accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && typeof data === "object") {
        latestStatus = data;
      }
    } catch {
      /* next poll will retry */
    }
  }

  return latestStatus;
}

export function useWhatsAppStatus({ pollIntervalMs = 8000, autoRestore = false } = {}) {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const planLimit = getWhatsAppAccountLimit(normalizePlan(profile?.plan || "") || profile?.plan);
  const [waStatus, setWaStatus] = useState(null);
  const restoreAttemptTimesRef = useRef(new Map());

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
        waStatus && typeof waStatus === "object" ? waStatus : await fetchWhatsAppStatus(userId);
      if (!current) return null;
      const next = await restorePersistedWhatsAppAccounts(
        userId,
        current,
        restoreAttemptTimesRef.current
      );
      setWaStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [userId, waStatus]);

  useEffect(() => {
    if (!userId) {
      setWaStatus(null);
      restoreAttemptTimesRef.current.clear();
      return undefined;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        let data = await fetchWhatsAppStatus(userId);
        if (cancelled || !data) return;
        if (autoRestore) {
          data = await restorePersistedWhatsAppAccounts(
            userId,
            data,
            restoreAttemptTimesRef.current
          );
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
