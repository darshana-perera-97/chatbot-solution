import { useEffect, useRef } from "react";
import { getWorkspaceUserProfile } from "../auth/userSession";
import {
  fetchWhatsAppStatus,
  restorePersistedWhatsAppAccounts,
} from "../hooks/useWhatsAppStatus";

/**
 * Restores saved WhatsApp sessions when the workspace app loads or the tab becomes visible again.
 * Closing all browser tabs does not stop the backend client, but reconnect may not finish until
 * the app asks the server to restore persisted sessions explicitly.
 */
export function WhatsAppAutoRestore() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const attemptedRef = useRef(new Set());
  const runningRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      attemptedRef.current.clear();
      return undefined;
    }

    let cancelled = false;

    const restore = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const status = await fetchWhatsAppStatus(userId);
        if (cancelled || !status) return;
        await restorePersistedWhatsAppAccounts(userId, status, attemptedRef.current);
      } catch {
        /* ignore — status polling elsewhere will surface errors */
      } finally {
        runningRef.current = false;
      }
    };

    void restore();

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void restore();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId]);

  return null;
}
