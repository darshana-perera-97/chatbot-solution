import { useEffect, useRef } from "react";
import { getWorkspaceUserProfile } from "../auth/userSession";
import {
  fetchWhatsAppStatus,
  restorePersistedWhatsAppAccounts,
  WHATSAPP_RESTORE_RETRY_MS,
} from "../hooks/useWhatsAppStatus";

/**
 * Keeps saved WhatsApp sessions online: restore on load, when the tab is visible again,
 * and on a timer while any linked account is still offline.
 */
export function WhatsAppAutoRestore() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const lastAttemptsRef = useRef(new Map());
  const runningRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      lastAttemptsRef.current.clear();
      return undefined;
    }

    let cancelled = false;

    const restore = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const status = await fetchWhatsAppStatus(userId);
        if (cancelled || !status) return;
        await restorePersistedWhatsAppAccounts(userId, status, lastAttemptsRef.current);
      } catch {
        /* status polling elsewhere will surface errors */
      } finally {
        runningRef.current = false;
      }
    };

    void restore();

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void restore();
    };

    const intervalId = setInterval(() => {
      if (cancelled || document.hidden) return;
      void restore();
    }, WHATSAPP_RESTORE_RETRY_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId]);

  return null;
}
