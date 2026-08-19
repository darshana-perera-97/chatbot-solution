import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Download, Loader2 } from "lucide-react";
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

function getSourceFilterKey(session) {
  const src = normalizeChatSource(session);
  if (src === "web") return "web";
  if (src === "whatsapp") {
    const accountId =
      typeof session?.whatsappAccountId === "string" ? session.whatsappAccountId.trim() : "1";
    return `whatsapp:${accountId || "1"}`;
  }
  return "test_bot";
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

  const headers = ["Name", "Email", "Phone", "Source", "Updated", "Exported", "Conversation ID", ...extraFieldKeys];
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => {
      const values = [
        getByLabelLike(row, /name|full\s*name/i),
        getByLabelLike(row, /email/i),
        getByLabelLike(row, /phone|mobile|contact/i),
        row.sourceLabel || "—",
        formatDate(row.updatedAt || row.createdAt),
        row.exported ? "Yes" : "No",
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
  const [actionError, setActionError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [exportFilter, setExportFilter] = useState("all");
  const [exportingIds, setExportingIds] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());

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
          sourceKey: session ? getSourceFilterKey(session) : null,
        };
      });
  }, [rows, sessionByConversationId]);

  const sourceOptions = useMemo(() => {
    const options = [
      { value: "all", label: "All sources" },
      { value: "test_bot", label: "Test Bot" },
      { value: "web", label: "Web" },
    ];
    const seen = new Set(["all", "test_bot", "web"]);

    const accounts = Array.isArray(waStatus?.accounts) ? waStatus.accounts : [];
    const connected = accounts.filter((account) => account.connected || account.phase === "ready");
    connected.forEach((account) => {
      const accountId = String(account.accountId || "1");
      const value = `whatsapp:${accountId}`;
      if (seen.has(value)) return;
      seen.add(value);
      const accLabel = whatsAppAccountLabel(account) || `Account ${accountId}`;
      options.push({
        value,
        label: `WhatsApp (${accLabel})`,
      });
    });

    enrichedRows.forEach((row) => {
      const value = row.sourceKey;
      if (!value || seen.has(value)) return;
      seen.add(value);
      options.push({
        value,
        label: row.sourceLabel || value,
      });
    });

    return options;
  }, [enrichedRows, waStatus]);

  const filteredRows = useMemo(() => {
    const rangeStart = dateFrom ? startOfDayMs(dateFrom) : null;
    const rangeEnd = dateTo ? endOfDayMs(dateTo) : null;

    return enrichedRows.filter((row) => {
      if (sourceFilter !== "all") {
        if (!row.sourceKey || row.sourceKey !== sourceFilter) return false;
      }

      if (exportFilter === "exported" && !row.exported) return false;
      if (exportFilter === "not_exported" && row.exported) return false;

      if (rangeStart == null && rangeEnd == null) return true;

      const stamp = getLeadTimestamp(row);
      if (stamp == null) return false;
      if (rangeStart != null && stamp < rangeStart) return false;
      if (rangeEnd != null && stamp > rangeEnd) return false;
      return true;
    });
  }, [dateFrom, dateTo, enrichedRows, exportFilter, sourceFilter]);

  const filtersActive = Boolean(dateFrom || dateTo || sourceFilter !== "all" || exportFilter !== "all");

  const selectableFilteredIds = useMemo(
    () =>
      filteredRows
        .map((row) => String(row.id || "").trim())
        .filter(Boolean),
    [filteredRows]
  );

  const selectedFilteredCount = useMemo(
    () => selectableFilteredIds.filter((id) => selectedIds.has(id)).length,
    [selectableFilteredIds, selectedIds]
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((id) => selectedIds.has(id));

  const someFilteredSelected =
    selectedFilteredCount > 0 && !allFilteredSelected;

  function toggleRowSelection(rowId) {
    const id = String(rowId || "").trim();
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableFilteredIds.forEach((id) => next.delete(id));
      } else {
        selectableFilteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedIds.has(String(row.id || "").trim())),
    [filteredRows, selectedIds]
  );

  function applyExportUpdates(updates) {
    if (!Array.isArray(updates) || !updates.length) return;
    const byId = new Map();
    updates.forEach((item) => {
      const id = String(item?.id || "").trim();
      if (id) byId.set(id, item);
    });
    setRows((prev) =>
      prev.map((row) => {
        const id = String(row.id || "").trim();
        const update = byId.get(id);
        if (!update) return row;
        return {
          ...row,
          exported: Boolean(update.exported),
          exportedAt: typeof update.exportedAt === "string" ? update.exportedAt : null,
        };
      })
    );
  }

  async function setExportStatus(leadIds, exported) {
    const ids = (Array.isArray(leadIds) ? leadIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (!userId || !ids.length) return false;

    setActionError("");
    setExportingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    try {
      const res = await fetch(apiUrl("/leads/exported"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, leadIds: ids, exported }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || "Could not update export status");
      }
      applyExportUpdates(Array.isArray(payload.leads) ? payload.leads : []);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update export status");
      return false;
    } finally {
      setExportingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  async function handleExportSelected() {
    if (!selectedRows.length) return;
    downloadInquiriesCsv(selectedRows);
    const idsToMark = selectedRows
      .filter((row) => !row.exported && row.id)
      .map((row) => String(row.id));
    if (idsToMark.length) {
      await setExportStatus(idsToMark, true);
    }
    setSelectedIds(new Set());
  }

  return (
    <main className="workspace-card">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="workspace-title">Inquiries</h1>
            <p className="workspace-subtitle">
              Collected lead data from chatbot field-capture sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportSelected}
            disabled={loading || selectedRows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] px-4 py-2 text-sm font-semibold text-[#7C3AED] transition hover:bg-[#F6F1FF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export selected{selectedRows.length ? ` (${selectedRows.length})` : ""}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 font-semibold text-[#7C3AED]">
            Showing: {filteredRows.length}
            {filtersActive ? ` of ${enrichedRows.length}` : ""}
          </span>
          {selectedFilteredCount > 0 ? (
            <span className="rounded-full bg-[#EDE9FE] px-2.5 py-1 font-semibold text-[#6D28D9]">
              Selected: {selectedFilteredCount}
            </span>
          ) : null}
        </div>
      </header>

      <section className="mb-4 rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              Source
            </span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full rounded-xl border border-[#EEE8FF] bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
            >
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Export status
            </span>
            <select
              value={exportFilter}
              onChange={(e) => setExportFilter(e.target.value)}
              className="w-full rounded-xl border border-[#EEE8FF] bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#C4B5FD] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20"
            >
              <option value="all">All</option>
              <option value="exported">Exported</option>
              <option value="not_exported">Not exported</option>
            </select>
          </label>
        </div>
      </section>

      {actionError ? (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {actionError}
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF]">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading inquiries...</div>
        ) : error ? (
          <div className="p-6 text-sm font-medium text-red-600">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            {enrichedRows.length === 0
              ? "No inquiries with contact details found yet."
              : "No inquiries match the selected filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] border-separate border-spacing-y-2 p-2 text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someFilteredSelected;
                      }}
                      onChange={toggleSelectAllFiltered}
                      disabled={selectableFilteredIds.length === 0}
                      aria-label="Select all inquiries in view"
                      className="h-4 w-4 rounded border-[#D8CCFF] text-[#7C3AED] focus:ring-[#8B5CF6]/30 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const rowId = String(row.id || "").trim();
                  const isBusy = rowId ? exportingIds.has(rowId) : false;
                  const isSelected = rowId ? selectedIds.has(rowId) : false;
                  return (
                    <tr
                      key={row.id || `${row.conversationId}-${row.updatedAt}`}
                      className={`rounded-xl bg-white shadow-sm ${isSelected ? "ring-1 ring-[#C4B5FD]" : ""}`}
                    >
                      <td className="rounded-l-xl px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!rowId}
                          onChange={() => toggleRowSelection(rowId)}
                          aria-label={`Select inquiry ${getByLabelLike(row, /name|full\s*name/i)}`}
                          className="h-4 w-4 rounded border-[#D8CCFF] text-[#7C3AED] focus:ring-[#8B5CF6]/30 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-slate-700">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!rowId || isBusy}
                            aria-label={row.exported ? "Mark as not exported" : "Mark as exported"}
                            title={
                              row.exported
                                ? `Exported${row.exportedAt ? ` ${formatDate(row.exportedAt)}` : ""} — click to unmark`
                                : "Mark as exported"
                            }
                            onClick={() => setExportStatus([rowId], !row.exported)}
                            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              row.exported
                                ? "text-emerald-600 hover:bg-emerald-50"
                                : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                            }`}
                          >
                            {isBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : row.exported ? (
                              <CheckCircle2 className="h-4 w-4" aria-hidden />
                            ) : (
                              <Circle className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                          <span>{getByLabelLike(row, /name|full\s*name/i)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        {getByLabelLike(row, /phone|mobile|contact/i)}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{row.sourceLabel}</td>
                      <td className="px-3 py-3 text-sm text-slate-500">{formatDate(row.updatedAt)}</td>
                      <td className="rounded-r-xl px-3 py-3 text-sm text-slate-500">
                        <button
                          type="button"
                          onClick={() =>
                            navigate("/chats", {
                              state: {
                                conversationId: String(row.conversationId || ""),
                              },
                            })
                          }
                          className="rounded-lg border border-[#E9DFFF] bg-[#FDFCFF] px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition hover:bg-[#F6F1FF]"
                        >
                          Open chat
                        </button>
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

export default Inquiries;
