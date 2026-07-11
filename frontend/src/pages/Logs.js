import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";

function formatDate(iso) {
  const value = typeof iso === "string" ? iso : "";
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function accountLabel(log) {
  const parts = [log?.pushname, log?.phone].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return log?.label || `Account ${log?.accountId || "1"}`;
}

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits || "";
}

function whatsAppLink(phone) {
  const digits = normalizeWhatsAppPhone(phone);
  if (!digits) return "";
  return `https://wa.me/${digits}`;
}

function formatEvent(event) {
  if (event === "linked") return "Linked";
  if (event === "disconnected") return "Disconnected";
  return event || "—";
}

function formatSource(source, event) {
  if (source === "qr_scan" || (event === "linked" && !source)) return "QR code scan";
  if (source === "user_disconnect_button") return "Disconnect button";
  return source || "—";
}

function eventBadgeClass(event) {
  if (event === "linked") {
    return "bg-emerald-50 text-emerald-800";
  }
  return "bg-amber-50 text-amber-800";
}

function Logs() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadLogs() {
      setLoading(true);
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setRows([]);
          return;
        }
        const res = await fetch(
          apiUrl(`/logs/whatsapp-disconnects?userId=${encodeURIComponent(userId)}`)
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.message || "Could not load logs");
        }
        if (!active) return;
        const records = Array.isArray(payload.logs) ? payload.logs : [];
        setRows(records);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load logs");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadLogs();
    return () => {
      active = false;
    };
  }, [userId]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aTime = Date.parse(a?.occurredAt || a?.disconnectedAt || "");
      const bTime = Date.parse(b?.occurredAt || b?.disconnectedAt || "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [rows]);

  const linkedCount = useMemo(
    () => sortedRows.filter((row) => row.event === "linked").length,
    [sortedRows]
  );
  const disconnectedCount = useMemo(
    () => sortedRows.filter((row) => row.event !== "linked").length,
    [sortedRows]
  );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Logs</h1>
        <p className="mt-2 text-sm text-slate-400">
          WhatsApp account links via QR scanner and disconnections from the Integrations page.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 font-semibold text-[#7C3AED]">
            Total: {sortedRows.length}
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            Linked: {linkedCount}
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
            Disconnected: {disconnectedCount}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF]">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading logs...</div>
        ) : error ? (
          <div className="p-6 text-sm font-medium text-red-600">{error}</div>
        ) : sortedRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No WhatsApp activity logged yet. Link an account by scanning the QR code on Integrations,
            or disconnect an account to see entries here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 p-2 text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Display name</th>
                  <th className="px-3 py-2 font-medium">WhatsApp link</th>
                  <th className="px-3 py-2 font-medium">Triggered by</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const event = row.event === "linked" ? "linked" : "disconnected";
                  const link = whatsAppLink(row.phone);
                  return (
                    <tr key={row.id} className="rounded-xl bg-white shadow-sm">
                      <td className="rounded-l-xl px-3 py-3 text-sm text-slate-600">
                        {formatDate(row.occurredAt || row.disconnectedAt)}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${eventBadgeClass(event)}`}
                        >
                          {formatEvent(event)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-slate-700">
                        {accountLabel(row)}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{row.phone || "—"}</td>
                      <td className="px-3 py-3 text-sm text-slate-600">{row.pushname || "—"}</td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:text-emerald-900"
                          >
                            Open chat
                            <ExternalLink size={14} aria-hidden />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="rounded-r-xl px-3 py-3 text-sm text-slate-600">
                        {formatSource(row.source, event)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default Logs;
