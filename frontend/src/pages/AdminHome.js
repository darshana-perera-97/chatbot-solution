import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bot,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Shield,
  UsersRound,
} from "lucide-react";
import { clearAdminSession } from "../auth/adminSession";
import { apiUrl } from "../apiBase";

const SUMMARY_CARDS = [
  {
    label: "Workspace users",
    value: "128",
    hint: "+6 this week",
    icon: UsersRound,
    tone: "from-violet-500 to-[#6D28D9]",
  },
  {
    label: "AI agents live",
    value: "14",
    hint: "3 drafts",
    icon: Bot,
    tone: "from-[#A78BFA] to-violet-600",
  },
  {
    label: "Access rules",
    value: "42",
    hint: "Synced",
    icon: KeyRound,
    tone: "from-[#8B5CF6] to-[#7C3AED]",
  },
  {
    label: "Active sessions",
    value: "31",
    hint: "Last hour",
    icon: Shield,
    tone: "from-[#6D28D9] to-violet-800",
  },
];

const INITIAL_SUMMARY = {
  workspaceUsers: 0,
  usersAddedThisWeek: 0,
  aiAgentsLive: 0,
  aiAgentsDrafts: 0,
  accessRules: 0,
  accessRulesHint: "Synced",
  activeSessions: 0,
  activeSessionsHint: "Last hour",
};

const INITIAL_USER_ROWS = [];

const ACCESS_ROWS = [
  {
    id: "1",
    resource: "Retail Sales Bot",
    level: "Full control",
    principal: "Owners group",
    updated: "Today, 09:12",
  },
  {
    id: "2",
    resource: "Support knowledge base",
    level: "Read / train",
    principal: "AI Engineers",
    updated: "Yesterday",
  },
  {
    id: "3",
    resource: "Billing & invoices",
    level: "No access",
    principal: "All viewers",
    updated: "Apr 12, 2026",
  },
  {
    id: "4",
    resource: "Channel: WhatsApp",
    level: "Publish",
    principal: "Dhea Mufni",
    updated: "Apr 10, 2026",
  },
];

function StatusPill({ status }) {
  const styles =
    status === "Active"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-600/15"
      : "bg-slate-100 text-slate-600 ring-slate-500/10";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles}`}
    >
      {status}
    </span>
  );
}

function AdminHome() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("users");
  const [userRows, setUserRows] = useState(INITIAL_USER_ROWS);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    contactNumber: "",
    plan: "Test",
    status: "Active",
  });
  const [formError, setFormError] = useState("");
  const [editFormError, setEditFormError] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [savingEditUser, setSavingEditUser] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editUser, setEditUser] = useState({
    id: "",
    username: "",
    email: "",
    password: "",
    contactNumber: "",
    plan: "Test",
    status: "Active",
  });
  const [summary, setSummary] = useState(INITIAL_SUMMARY);

  const summaryCards = useMemo(
    () => [
      {
        ...SUMMARY_CARDS[0],
        value: String(summary.workspaceUsers),
        hint: `+${summary.usersAddedThisWeek} this week`,
      },
      {
        ...SUMMARY_CARDS[1],
        value: String(summary.aiAgentsLive),
        hint: `${summary.aiAgentsDrafts} drafts`,
      },
      {
        ...SUMMARY_CARDS[2],
        value: String(summary.accessRules),
        hint: summary.accessRulesHint,
      },
      {
        ...SUMMARY_CARDS[3],
        value: String(summary.activeSessions),
        hint: summary.activeSessionsHint,
      },
    ],
    [summary]
  );

  const handleLogout = () => {
    clearAdminSession();
    navigate("/admin/login", { replace: true });
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    setUsersError("");
    try {
      const res = await fetch(apiUrl("/admin/accounts"));
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        throw new Error(data.message || `Failed to load users (${res.status})`);
      }
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      setUserRows(accounts);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadSummary = async () => {
    try {
      const res = await fetch(apiUrl("/admin/metrics"));
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) return;
      setSummary({
        workspaceUsers: Number(data.workspaceUsers) || 0,
        usersAddedThisWeek: Number(data.usersAddedThisWeek) || 0,
        aiAgentsLive: Number(data.aiAgentsLive) || 0,
        aiAgentsDrafts: Number(data.aiAgentsDrafts) || 0,
        accessRules: Number(data.accessRules) || 0,
        accessRulesHint: String(data.accessRulesHint || "Synced"),
        activeSessions: Number(data.activeSessions) || 0,
        activeSessionsHint: String(data.activeSessionsHint || "Last hour"),
      });
    } catch {
      // Keep current values when metrics endpoint is unavailable.
    }
  };

  useEffect(() => {
    loadUsers();
    loadSummary();
  }, []);

  useEffect(() => {
    if (tab === "users") {
      loadUsers();
    }
  }, [tab]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    const username = newUser.username.trim();
    const email = newUser.email.trim().toLowerCase();
    const password = newUser.password;
    const contactNumber = newUser.contactNumber.trim();
    const plan = newUser.plan.trim();
    const status = newUser.status.trim();

    if (!username || !email || !password || !contactNumber || !plan || !status) {
      setFormError("Please fill in all fields.");
      return;
    }
    if (!email.includes("@") || !email.includes(".")) {
      setFormError("Please enter a valid email address.");
      return;
    }
    try {
      setSavingUser(true);
      const res = await fetch(apiUrl("/admin/accounts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          contactNumber,
          plan,
          status,
        }),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setFormError(data.message || `Failed to add user (${res.status})`);
        return;
      }
      await loadUsers();
      await loadSummary();
      setNewUser({
        username: "",
        email: "",
        password: "",
        contactNumber: "",
        plan: "Test",
        status: "Active",
      });
      setFormError("");
      setIsAddUserOpen(false);
    } catch {
      setFormError("Could not reach server.");
    } finally {
      setSavingUser(false);
    }
  };

  const openEditUserModal = (row) => {
    setEditFormError("");
    setShowEditPassword(false);
    setEditUser({
      id: String(row.id || ""),
      username: String(row.username || ""),
      email: String(row.email || ""),
      password: String(row.password || ""),
      contactNumber: String(row.contactNumber || ""),
      plan: String(row.plan || "Test"),
      status: String(row.status || "Active"),
    });
    setIsEditUserOpen(true);
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    const id = editUser.id;
    const username = editUser.username.trim();
    const email = editUser.email.trim().toLowerCase();
    const password = editUser.password;
    const contactNumber = editUser.contactNumber.trim();
    const plan = editUser.plan.trim();
    const status = editUser.status.trim();

    if (!id || !username || !email || !password || !contactNumber || !plan || !status) {
      setEditFormError("Please fill in all fields.");
      return;
    }
    if (!email.includes("@") || !email.includes(".")) {
      setEditFormError("Please enter a valid email address.");
      return;
    }
    try {
      setSavingEditUser(true);
      const res = await fetch(apiUrl(`/admin/accounts/${encodeURIComponent(id)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          contactNumber,
          plan,
          status,
        }),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setEditFormError(data.message || `Failed to update user (${res.status})`);
        return;
      }
      await loadUsers();
      await loadSummary();
      setEditFormError("");
      setIsEditUserOpen(false);
    } catch {
      setEditFormError("Could not reach server.");
    } finally {
      setSavingEditUser(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FCFAFF] text-slate-800">
      <header className="border-b border-[#F0E9FF] bg-white/90 px-5 py-4 shadow-sm backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] text-white shadow-md shadow-violet-500/25">
              <Shield className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <p className="font-bold text-slate-900">AI Agent console</p>
              <p className="text-xs text-slate-500">Admin</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-[#F0E9FF] bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#E9D5FF] hover:bg-[#FAF7FF] sm:px-4"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Workspace</span>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-xl border border-[#F0E9FF] bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#E9D5FF] hover:bg-[#FAF7FF] sm:px-4"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Overview</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Monitor usage and manage people and permissions for your AI agents.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="rounded-2xl border border-[#F0E9FF] bg-white p-5 shadow-[0_12px_40px_rgba(139,92,246,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{card.value}</p>
                    <p className="mt-1 text-xs font-medium text-[#7C3AED]">{card.hint}</p>
                  </div>
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${card.tone}`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-[#F0E9FF] bg-white shadow-[0_18px_50px_rgba(139,92,246,0.08)]">
          <div
            role="tablist"
            aria-label="Admin sections"
            className="flex border-b border-[#F0E9FF] bg-[#FDFCFF] px-2 pt-2 sm:px-4"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "users"}
              id="tab-users"
              aria-controls="panel-users"
              onClick={() => setTab("users")}
              className={`relative -mb-px rounded-t-xl px-4 py-3 text-sm font-semibold transition sm:px-6 ${
                tab === "users"
                  ? "bg-white text-[#4C1D95] shadow-[0_-1px_0_0_white] ring-1 ring-[#F0E9FF] ring-b-0"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              User Management
              {tab === "users" ? (
                <span
                  aria-hidden
                  className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#7C3AED] sm:inset-x-6"
                />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "access"}
              id="tab-access"
              aria-controls="panel-access"
              onClick={() => setTab("access")}
              className={`relative -mb-px rounded-t-xl px-4 py-3 text-sm font-semibold transition sm:px-6 ${
                tab === "access"
                  ? "bg-white text-[#4C1D95] shadow-[0_-1px_0_0_white] ring-1 ring-[#F0E9FF] ring-b-0"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Control Access
              {tab === "access" ? (
                <span
                  aria-hidden
                  className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#7C3AED] sm:inset-x-6"
                />
              ) : null}
            </button>
          </div>

          <div className="p-4 sm:p-6">
            {tab === "users" ? (
              <div
                role="tabpanel"
                id="panel-users"
                aria-labelledby="tab-users"
                className="overflow-x-auto"
              >
                <div className="mb-5 flex min-w-[640px] items-center justify-between rounded-2xl border border-[#F0E9FF] bg-[#FCFAFF] p-4">
                  <p className="text-sm text-slate-600">
                    Manage workspace accounts and invite new users from this panel.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadUsers}
                      className="rounded-xl border border-[#E9D5FF] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormError("");
                        setShowAddPassword(false);
                        setIsAddUserOpen(true);
                      }}
                      className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
                    >
                      Add user
                    </button>
                  </div>
                </div>
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#F0E9FF] text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <th className="pb-3 pr-4 font-semibold">Username</th>
                      <th className="pb-3 pr-4 font-semibold">Email</th>
                      <th className="pb-3 pr-4 font-semibold">Contact Number</th>
                      <th className="pb-3 pr-4 font-semibold">Plan</th>
                      <th className="pb-3 pr-4 font-semibold">Status</th>
                      <th className="pb-3 pr-0 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F0FF]">
                    {loadingUsers ? (
                      <tr>
                        <td className="py-4 text-slate-500" colSpan={6}>
                          Loading users...
                        </td>
                      </tr>
                    ) : null}
                    {!loadingUsers && usersError ? (
                      <tr>
                        <td className="py-4 text-red-600" colSpan={6}>
                          {usersError}
                        </td>
                      </tr>
                    ) : null}
                    {!loadingUsers && !usersError && userRows.length === 0 ? (
                      <tr>
                        <td className="py-4 text-slate-500" colSpan={6}>
                          No users added yet.
                        </td>
                      </tr>
                    ) : null}
                    {userRows.map((row) => (
                      <tr key={row.id} className="text-slate-700">
                        <td className="py-3.5 pr-4 font-semibold text-slate-900">{row.username}</td>
                        <td className="py-3.5 pr-4 text-slate-600">{row.email}</td>
                        <td className="py-3.5 pr-4">{row.contactNumber}</td>
                        <td className="py-3.5 pr-4">{row.plan}</td>
                        <td className="py-3.5 pr-4">
                          <StatusPill status={row.status} />
                        </td>
                        <td className="py-3.5 pr-0 text-right">
                          <button
                            type="button"
                            onClick={() => openEditUserModal(row)}
                            className="rounded-lg border border-[#E9D5FF] px-3 py-1 text-xs font-semibold text-[#6D28D9] transition hover:bg-[#F8F4FF]"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                role="tabpanel"
                id="panel-access"
                aria-labelledby="tab-access"
                className="overflow-x-auto"
              >
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#F0E9FF] text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <th className="pb-3 pr-4 font-semibold">Resource</th>
                      <th className="pb-3 pr-4 font-semibold">Access level</th>
                      <th className="pb-3 pr-4 font-semibold">Principal</th>
                      <th className="pb-3 font-semibold">Last updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F0FF]">
                    {ACCESS_ROWS.map((row) => (
                      <tr key={row.id} className="text-slate-700">
                        <td className="py-3.5 pr-4 font-semibold text-slate-900">{row.resource}</td>
                        <td className="py-3.5 pr-4">{row.level}</td>
                        <td className="py-3.5 pr-4 text-slate-600">{row.principal}</td>
                        <td className="py-3.5 text-slate-500">{row.updated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {isAddUserOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-user-title"
          onClick={() => setIsAddUserOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#E9D5FF] bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-user-title" className="text-xl font-bold text-slate-900">
              Add user
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Add account details. Records are stored in backend `accounts.json`.
            </p>

            <form onSubmit={handleAddUser} className="mt-5 space-y-3">
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="Username"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />
              <div className="flex items-center gap-2">
                <input
                  type={showAddPassword ? "text" : "password"}
                  value={newUser.password}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Password"
                  className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowAddPassword((prev) => !prev)}
                  className="rounded-xl border border-[#E9D5FF] px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  {showAddPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type="text"
                value={newUser.contactNumber}
                onChange={(e) => setNewUser((prev) => ({ ...prev, contactNumber: e.target.value }))}
                placeholder="Contact number"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />
              <select
                value={newUser.plan}
                onChange={(e) => setNewUser((prev) => ({ ...prev, plan: e.target.value }))}
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              >
                <option value="Test">Test</option>
                <option value="Trial">Trial</option>
                <option value="Basic">Basic</option>
                <option value="Pro">Pro</option>
              </select>
              <select
                value={newUser.status}
                onChange={(e) => setNewUser((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Email address"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />

              {formError ? <p className="text-xs font-medium text-red-600">{formError}</p> : null}

              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="rounded-xl border border-[#E9D5FF] px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
                >
                  {savingUser ? "Saving..." : "Add user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isEditUserOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
          onClick={() => setIsEditUserOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#E9D5FF] bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="edit-user-title" className="text-xl font-bold text-slate-900">
              Edit user
            </h2>
            <p className="mt-1 text-sm text-slate-500">Update account details and save changes.</p>

            <form onSubmit={handleEditUser} className="mt-5 space-y-3">
              <input
                type="text"
                value={editUser.username}
                onChange={(e) => setEditUser((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="Username"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />
              <div className="flex items-center gap-2">
                <input
                  type={showEditPassword ? "text" : "password"}
                  value={editUser.password}
                  onChange={(e) => setEditUser((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Password"
                  className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword((prev) => !prev)}
                  className="rounded-xl border border-[#E9D5FF] px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  {showEditPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type="text"
                value={editUser.contactNumber}
                onChange={(e) => setEditUser((prev) => ({ ...prev, contactNumber: e.target.value }))}
                placeholder="Contact number"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />
              <select
                value={editUser.plan}
                onChange={(e) => setEditUser((prev) => ({ ...prev, plan: e.target.value }))}
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              >
                <option value="Test">Test</option>
                <option value="Trial">Trial</option>
                <option value="Basic">Basic</option>
                <option value="Pro">Pro</option>
              </select>
              <select
                value={editUser.status}
                onChange={(e) => setEditUser((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <input
                type="email"
                value={editUser.email}
                onChange={(e) => setEditUser((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Email address"
                className="w-full rounded-xl border border-[#E9D5FF] bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-[#C4B5FD] transition focus:ring-2"
              />

              {editFormError ? <p className="text-xs font-medium text-red-600">{editFormError}</p> : null}

              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditUserOpen(false)}
                  className="rounded-xl border border-[#E9D5FF] px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditUser}
                  className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
                >
                  {savingEditUser ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminHome;
