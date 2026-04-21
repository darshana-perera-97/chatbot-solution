import { useEffect, useMemo, useState } from "react";
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

function Inquiries() {
  const navigate = useNavigate();
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadInquiries() {
      setLoading(true);
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setRows([]);
          return;
        }
        const res = await fetch(apiUrl(`/leads?userId=${encodeURIComponent(userId)}`));
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.message || "Could not load inquiries");
        }
        if (!active) return;
        const records = Array.isArray(payload.leads) ? payload.leads : [];
        setRows(records);
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

  const total = rows.length;
  const hasEmailOrContact = (row) =>
    Object.entries(row?.collectedData || {}).some(
      ([key, value]) =>
        /email|phone|mobile|contact/i.test(String(key)) && String(value || "").trim()
    );

  const visibleRows = useMemo(() => rows.filter(hasEmailOrContact), [rows]);
  const withEmail = useMemo(() => {
    const hasEmail = (row) =>
      Object.entries(row?.collectedData || {}).some(
        ([key, value]) => /email/i.test(String(key)) && String(value || "").trim()
      );
    return visibleRows.filter(hasEmail).length;
  }, [visibleRows]);

  const getByLabelLike = (row, regex) => {
    const entries = Object.entries(row?.collectedData || {});
    const match = entries.find(([key, value]) => regex.test(String(key)) && String(value || "").trim());
    return match ? String(match[1]) : "—";
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Inquiries</h1>
        <p className="mt-2 text-sm text-slate-400">
          Collected lead data from chatbot field-capture sessions.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 font-semibold text-[#7C3AED]">
            Total: {visibleRows.length}
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            With Email: {withEmail}
          </span>
        </div>
      </header>

      <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF]">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading inquiries...</div>
        ) : error ? (
          <div className="p-6 text-sm font-medium text-red-600">{error}</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No inquiries with email or contact number found yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 p-2 text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
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
