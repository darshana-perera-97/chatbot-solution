import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";

function formatDate(iso) {
  const value = typeof iso === "string" ? iso : "";
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function normalizeChatSource(session) {
  const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
  if (raw === "web") return "web";
  if (raw === "whatsapp") return "whatsapp";
  return "test_bot";
}

function formatSessionSourceLabel(session) {
  const src = normalizeChatSource(session);
  const acc =
    typeof session?.channelAccountName === "string" ? session.channelAccountName.trim() : "";
  if (src === "web") return "Web";
  if (src === "whatsapp") return acc ? `WhatsApp (${acc})` : "WhatsApp";
  return "Test Bot";
}

function getAccountFilterKey(session) {
  const src = normalizeChatSource(session);
  if (src !== "whatsapp") return null;
  const accountId =
    typeof session?.whatsappAccountId === "string" ? session.whatsappAccountId.trim() : "1";
  return `whatsapp:${accountId || "1"}`;
}

function whatsAppAccountLabel(account) {
  if (!account) return "";
  const parts = [account.pushname, account.phone].filter(Boolean);
  return parts.length ? parts.join(" · ") : account.label || `Account ${account.accountId}`;
}

function hasEmailOrContact(row) {
  return Object.entries(row?.collectedData || {}).some(
    ([key, value]) => /email|phone|mobile|contact/i.test(String(key)) && String(value || "").trim()
  );
}

function getByLabelLike(row, regex) {
  const entries = Object.entries(row?.collectedData || {});
  const match = entries.find(([key, value]) => regex.test(String(key)) && String(value || "").trim());
  return match ? String(match[1]) : "—";
}

function getLeadTimestamp(row) {
  const stamp = Date.parse(row?.updatedAt || row?.createdAt || "");
  return Number.isFinite(stamp) ? stamp : null;
}

function startOfDayMs(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDayMs(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function escapeCsvField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadInquiriesCsv(rows) {
  if (!rows.length) return;

  const extraFieldKeys = [];
  const extraFieldSet = new Set();
  rows.forEach((row) => {
    Object.entries(row?.collectedData || {}).forEach(([key, value]) => {
      if (!String(value || "").trim()) return;
      if (/name|full\s*name|email|phone|mobile|contact/i.test(String(key))) return;
      if (!extraFieldSet.has(key)) {
        extraFieldSet.add(key);
        extraFieldKeys.push(key);
      }
    });
  });

  const headers = ["Name", "Email", "Phone", "Source", "Updated", "Conversation ID", ...extraFieldKeys];
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => {
      const values = [
        getByLabelLike(row, /name|full\s*name/i),
        getByLabelLike(row, /email/i),
        getByLabelLike(row, /phone|mobile|contact/i),
        row.sourceLabel || "—",
        formatDate(row.updatedAt || row.createdAt),
        row.conversationId || "",
        ...extraFieldKeys.map((key) => row?.collectedData?.[key] ?? ""),
      ];
      return values.map(escapeCsvField).join(",");
    }),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `inquiries-${stamp}.csv`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Inquiries() {
  const navigate = useNavigate();
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const [rows, setRows] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [waStatus, setWaStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadInquiries() {
      setLoading(true);
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setRows([]);
          setSessions([]);
          setWaStatus(null);
          return;
        }
        const [leadsRes, sessionsRes, waRes] = await Promise.all([
          fetch(apiUrl(`/leads?userId=${encodeURIComponent(userId)}`)),
          fetch(apiUrl(`/chat/test/sessions?userId=${encodeURIComponent(userId)}`)),
          fetch(apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`)),
        ]);
        const leadsPayload = await leadsRes.json().catch(() => ({}));
        const sessionsPayload = await sessionsRes.json().catch(() => ({}));
        const waPayload = await waRes.json().catch(() => ({}));
        if (!leadsRes.ok) {
          throw new Error(leadsPayload.message || "Could not load inquiries");
        }
        if (!sessionsRes.ok) {
          throw new Error(sessionsPayload.message || "Could not load conversation sources");
        }
        if (!active) return;
        const records = Array.isArray(leadsPayload.leads) ? leadsPayload.leads : [];
        const sessionRecords = Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : [];
        setRows(records);
        setSessions(sessionRecords);
        setWaStatus(waPayload && typeof waPayload === "object" ? waPayload : null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load inquiries");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInquiries();
    return () => {
      active = false;
    };
  }, [userId]);

  const sessionByConversationId = useMemo(() => {
    const map = new Map();
    sessions.forEach((session) => {
      const conversationId =
        typeof session?.conversationId === "string" ? session.conversationId.trim() : "";
      if (conversationId) map.set(conversationId, session);
    });
    return map;
  }, [sessions]);

  const enrichedRows = useMemo(() => {
    return rows
      .filter(hasEmailOrContact)
      .map((row) => {
        const session = sessionByConversationId.get(String(row.conversationId || "").trim()) || null;
        return {
          ...row,
          session,
          sourceLabel: session ? formatSessionSourceLabel(session) : "Unknown",
          accountKey: session ? getAccountFilterKey(session) : null,
        };
      });
  }, [rows, sessionByConversationId]);

  const whatsappAccountOptions = useMemo(() => {
    const accounts = Array.isArray(waStatus?.accounts) ? waStatus.accounts : [];
    const connected = accounts.filter((account) => account.connected || account.phase === "ready");
    const options = [{ value: "all", label: "All WhatsApp accounts" }];
    connected.forEach((account) => {
      const accountId = String(account.accountId || "1");
      options.push({
        value: `whatsapp:${accountId}`,
        label: whatsAppAccountLabel(account),
      });
    });
    return options;
  }, [waStatus]);

  const filteredRows = useMemo(() => {
    const rangeStart = dateFrom ? startOfDayMs(dateFrom) : null;
    const rangeEnd = dateTo ? endOfDayMs(dateTo) : null;

    return enrichedRows.filter((row) => {
      if (accountFilter !== "all") {
        if (!row.accountKey || row.accountKey !== accountFilter) return false;
      }

      if (rangeStart == null && rangeEnd == null) return true;

      const stamp = getLeadTimestamp(row);
      if (stamp == null) return false;
      if (rangeStart != null && stamp < rangeStart) return false;
      if (rangeEnd != null && stamp > rangeEnd) return false;
      return true;
    });
  }, [accountFilter, dateFrom, dateTo, enrichedRows]);

  const withEmail = useMemo(() => {
    const hasEmail = (row) =>
      Object.entries(row?.collectedData || {}).some(
        ([key, value]) => /email/i.test(String(key)) && String(value || "").trim()
      );
    return filteredRows.filter(hasEmail).length;
  }, [filteredRows]);

  const filtersActive = Boolean(dateFrom || dateTo || accountFilter !== "all");

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Inquiries</h1>
            <p className="mt-2 text-sm text-slate-400">
              Collected lead data from chatbot field-capture sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadInquiriesCsv(filteredRows)}
            disabled={loading || filteredRows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] px-4 py-2 text-sm font-semibold text-[#7C3AED] transition hover:bg-[#F6F1FF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download CSV
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 font-semibold text-[#7C3AED]">
            Showing: {filteredRows.length}
            {filtersActive ? ` of ${enrichedRows.length}` : ""}
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            With Email: {withEmail}
          </span>
        </div>
      </header>

      <section className="mb-4 rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Start date
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-[#EEE8FF] bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              End date
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-[#EEE8FF] bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              WhatsApp account
            </span>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="w-full rounded-xl border border-[#EEE8FF] bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
            >
              {whatsappAccountOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF]">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading inquiries...</div>
        ) : error ? (
          <div className="p-6 text-sm font-medium text-red-600">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            {enrichedRows.length === 0
              ? "No inquiries with email or contact number found yet."
              : "No inquiries match the selected filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 p-2 text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.id || `${row.conversationId}-${row.updatedAt}`}
                    className="rounded-xl bg-white shadow-sm"
                  >
                    <td className="rounded-l-xl px-3 py-3 text-sm font-semibold text-slate-700">
                      {getByLabelLike(row, /name|full\s*name/i)}
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-600">{getByLabelLike(row, /email/i)}</td>
                    <td className="px-3 py-3 text-sm text-slate-600">
                      {getByLabelLike(row, /phone|mobile|contact/i)}
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-600">{row.sourceLabel}</td>
                    <td className="px-3 py-3 text-sm text-slate-500">{formatDate(row.updatedAt)}</td>
                    <td className="rounded-r-xl px-3 py-3 text-sm text-slate-500">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/chats?conversationId=${encodeURIComponent(
                              String(row.conversationId || "")
                            )}`
                          )
                        }
                        className="rounded-lg border border-[#E9DFFF] bg-[#FDFCFF] px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition hover:bg-[#F6F1FF]"
                      >
                        Open chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default Inquiries;
