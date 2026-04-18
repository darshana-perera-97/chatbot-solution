import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Briefcase,
  ChevronRight,
  ClipboardList,
  FolderKanban,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";
import avatarAntonion from "../assets/avatar-antonion.svg";
import avatarDhea from "../assets/avatar-dhea.svg";
import avatarRina from "../assets/avatar-rina.svg";
import avatarZaenal from "../assets/avatar-zaenal.svg";
import dashboardHero from "../assets/dashboard-hero.svg";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../apiBase";
import { LeadQualityCell } from "../components/LeadQualityCell";
import { consumeWorkspaceLoginPopup, getWorkspaceUserProfile } from "../auth/userSession";

const activityData = [
  { day: "Mon", value: 62 },
  { day: "Tue", value: 78 },
  { day: "Wed", value: 74 },
  { day: "Thu", value: 86 },
  { day: "Fri", value: 92 },
  { day: "Sat", value: 108 },
  { day: "Sun", value: 116 },
];

const projects = [
  {
    title: "Retail Sales Bot",
    count: "2 Channels",
    tone: "bg-[#F4ECFF]",
    icon: Briefcase,
  },
  {
    title: "Customer Support Bot",
    count: "4 Flows",
    tone: "bg-[#FEF3E8]",
    icon: FolderKanban,
  },
  {
    title: "Appointment Assistant",
    count: "16 Intents",
    tone: "bg-[#EFEAFE]",
    icon: Sparkles,
  },
];

function Dashboard() {
  const navigate = useNavigate();
  const [loginPopup, setLoginPopup] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [leads, setLeads] = useState([]);
  const [agentDetails, setAgentDetails] = useState(null);
  const [widgetSettings, setWidgetSettings] = useState(null);
  const [aiControlSaving, setAiControlSaving] = useState(false);
  const [liveDataError, setLiveDataError] = useState("");
  const [waStatus, setWaStatus] = useState(null);
  const userProfile = getWorkspaceUserProfile();
  const userId = userProfile?.id ? String(userProfile.id).trim() : "";
  const displayName =
    userProfile?.username || (userProfile?.email ? userProfile.email.split("@")[0] : "") || "User";
  const displayEmail = userProfile?.email || "No email available";
  const overviewDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    []
  );

  useEffect(() => {
    const payload = consumeWorkspaceLoginPopup();
    if (payload) {
      setLoginPopup(payload);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLiveData() {
      setLiveDataError("");
      try {
        if (!userId) {
          if (!active) return;
          setSessions([]);
          setLeads([]);
          setWidgetSettings(null);
          return;
        }
        const [sessionsRes, leadsRes, detailsRes, widgetRes] = await Promise.all([
          fetch(apiUrl(`/chat/test/sessions?userId=${encodeURIComponent(userId)}`)),
          fetch(apiUrl(`/leads?userId=${encodeURIComponent(userId)}`)),
          fetch(apiUrl(`/agent-details?userId=${encodeURIComponent(userId)}`)),
          fetch(apiUrl(`/widget-settings?userId=${encodeURIComponent(userId)}`)),
        ]);
        const sessionsPayload = await sessionsRes.json().catch(() => ({}));
        const leadsPayload = await leadsRes.json().catch(() => ({}));
        const detailsPayload = await detailsRes.json().catch(() => ({}));
        const widgetPayload = await widgetRes.json().catch(() => ({}));
        if (!sessionsRes.ok) {
          throw new Error(sessionsPayload.message || "Could not load user conversations");
        }
        if (!leadsRes.ok) {
          throw new Error(leadsPayload.message || "Could not load user leads");
        }
        if (!detailsRes.ok) {
          throw new Error(detailsPayload?.message || "Could not load user knowledgebase");
        }
        if (!widgetRes.ok) {
          throw new Error(widgetPayload.message || "Could not load widget settings");
        }
        if (!active) return;
        setSessions(Array.isArray(sessionsPayload.sessions) ? sessionsPayload.sessions : []);
        setLeads(Array.isArray(leadsPayload.leads) ? leadsPayload.leads : []);
        setAgentDetails(detailsPayload?.details && typeof detailsPayload.details === "object" ? detailsPayload.details : null);
        setWidgetSettings(
          widgetPayload?.settings && typeof widgetPayload.settings === "object" ? widgetPayload.settings : null
        );
      } catch (err) {
        if (!active) return;
        setLiveDataError(err instanceof Error ? err.message : "Could not load live dashboard data");
      }
    }
    loadLiveData();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function loadWaStatus() {
      if (!userId) {
        if (active) setWaStatus(null);
        return;
      }
      try {
        const res = await fetch(
          apiUrl(`/integrations/whatsapp/status?userId=${encodeURIComponent(userId)}`)
        );
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        setWaStatus(res.ok && data && typeof data === "object" ? data : null);
      } catch {
        if (active) setWaStatus(null);
      }
    }

    void loadWaStatus();
    intervalId = setInterval(() => {
      if (!document.hidden) void loadWaStatus();
    }, 12000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [userId]);

  const toggleAiReplies = async (enabled) => {
    if (!userId || !widgetSettings || aiControlSaving) return;
    setAiControlSaving(true);
    setLiveDataError("");
    try {
      const res = await fetch(apiUrl("/widget-settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...widgetSettings, aiRepliesEnabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not update AI Agent control");
      if (data.settings && typeof data.settings === "object") {
        setWidgetSettings(data.settings);
      }
    } catch (err) {
      setLiveDataError(err instanceof Error ? err.message : "Could not update AI Agent control");
    } finally {
      setAiControlSaving(false);
    }
  };

  const liveConversationCount = sessions.length;
  const liveLeadCount = leads.length;
  const isSubmittedLead = (lead) =>
    Object.entries(lead?.collectedData || {}).some(
      ([key, value]) =>
        /email|phone|mobile|contact/i.test(String(key)) && String(value || "").trim().length > 0
    );
  const submittedLeadCount = leads.filter(isSubmittedLead).length;
  const buildersCount = submittedLeadCount;
  const waConnected = Boolean(waStatus?.connected || waStatus?.phase === "ready");
  const waDetailLine = (() => {
    if (!userId) return "Sign in to view status";
    if (waStatus?.available === false) return "Backend library not loaded";
    if (waConnected) {
      const parts = [waStatus?.pushname, waStatus?.phone].filter(
        (p) => typeof p === "string" && p.trim()
      );
      return parts.length ? parts.join(" · ") : "Linked device active";
    }
    const phase = typeof waStatus?.phase === "string" ? waStatus.phase : "";
    if (phase && phase !== "disconnected") {
      return phase === "qr"
        ? "Scan QR in Integrations"
        : `${phase.charAt(0).toUpperCase() + phase.slice(1)}…`;
    }
    return "Connect in Integrations";
  })();
  const submittedChatsCount = Math.min(submittedLeadCount, liveConversationCount);
  const liveAgentSessions = sessions.filter((session) => Boolean(session?.liveAgentEnabled)).length;
  const aiManagedSessions = Math.max(0, liveConversationCount - liveAgentSessions);
  const deploymentTotal = Math.max(1, liveConversationCount);
  const liveAgentPercent = Math.round((liveAgentSessions / deploymentTotal) * 100);
  const aiManagedPercent = Math.max(0, 100 - liveAgentPercent);
  const leadCoveragePercent =
    liveConversationCount > 0
      ? Math.max(0, Math.min(100, Math.round((liveLeadCount / liveConversationCount) * 100)))
      : 0;
  const deploymentDataLive = [
    { name: "Live Agent", value: liveAgentPercent },
    { name: "AI Managed", value: aiManagedPercent },
  ];
  const activityDataLive = useMemo(() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayBuckets = new Map(labels.map((day) => [day, 0]));
    sessions.forEach((session) => {
      const stamp = Date.parse(session?.updatedAt || session?.createdAt || "");
      if (!Number.isFinite(stamp)) return;
      const date = new Date(stamp);
      const day = labels[(date.getDay() + 6) % 7];
      dayBuckets.set(day, (dayBuckets.get(day) || 0) + (Number(session?.messageCount) || 0));
    });
    return labels.map((day) => ({ day, value: dayBuckets.get(day) || 0 }));
  }, [sessions]);
  const productsCount = Array.isArray(agentDetails?.productsOrServices)
    ? agentDetails.productsOrServices.length
    : 0;
  const fieldsToCollectCount = Array.isArray(agentDetails?.fieldsToCollect)
    ? agentDetails.fieldsToCollect.length
    : 0;
  const kbSectionsFilled = [
    agentDetails?.basicDetails,
    agentDetails?.companyDetails,
    agentDetails?.agentTargets,
    agentDetails?.otherDetails,
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
  const channelSet = new Set(["Web Widget"]);
  if (sessions.some((session) => session?.liveAgentEnabled)) channelSet.add("Live Agent");
  if (leads.length > 0) channelSet.add("Lead Capture");
  const projectsLive = [
    {
      title: "Knowledgebase",
      count: `${kbSectionsFilled}/4 sections . ${productsCount} products`,
      tone: "bg-[#F4ECFF]",
      icon: FolderKanban,
    },
    {
      title: "Lead Qualification",
      count: `${submittedLeadCount} submitted leads . ${fieldsToCollectCount} collection fields`,
      tone: "bg-[#FEF3E8]",
      icon: ClipboardList,
    },
    {
      title: "Channel Coverage",
      count: `${channelSet.size} active channels`,
      tone: "bg-[#EFEAFE]",
      icon: Sparkles,
    },
  ];
  const leadTrendData = useMemo(() => {
    const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        month: monthFormatter.format(d),
        chats: 0,
        leads: 0,
      });
    }
    const byKey = new Map(months.map((item) => [item.key, item]));
    sessions.forEach((session) => {
      const stamp = Date.parse(session?.updatedAt || session?.createdAt || "");
      if (!Number.isFinite(stamp)) return;
      const d = new Date(stamp);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = byKey.get(key);
      if (!bucket) return;
      bucket.chats += 1;
    });
    leads.filter(isSubmittedLead).forEach((lead) => {
      const stamp = Date.parse(lead?.updatedAt || lead?.createdAt || "");
      if (!Number.isFinite(stamp)) return;
      const d = new Date(stamp);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = byKey.get(key);
      if (!bucket) return;
      bucket.leads += 1;
    });
    return months.map((item) => ({
      month: item.month,
      submitted: item.leads,
      totalChats: item.chats,
    }));
  }, [leads, sessions]);
  const workloadDataLive = useMemo(() => {
    const channelRows = [
      { key: "whatsapp", team: "WhatsApp" },
      { key: "web", team: "Web" },
      { key: "test_bot", team: "Test Bot" },
    ];
    const counts = new Map(
      channelRows.map(({ key }) => [key, { aiManaged: 0, liveAgent: 0 }])
    );
    sessions.forEach((session) => {
      const raw = typeof session?.chatSource === "string" ? session.chatSource.trim().toLowerCase() : "";
      const key =
        raw === "web" ? "web" : raw === "whatsapp" ? "whatsapp" : "test_bot";
      const bucket = counts.get(key);
      if (!bucket) return;
      if (session?.liveAgentEnabled) bucket.liveAgent += 1;
      else bucket.aiManaged += 1;
    });
    return channelRows.map(({ key, team }) => {
      const row = counts.get(key);
      return {
        team,
        done: row?.aiManaged ?? 0,
        pending: row?.liveAgent ?? 0,
      };
    });
  }, [sessions]);
  const getByLabelLike = (row, regex) => {
    const entries = Object.entries(row?.collectedData || {});
    const match = entries.find(([key, value]) => regex.test(String(key)) && String(value || "").trim());
    return match ? String(match[1]) : "—";
  };
  const visibleInquiryRows = useMemo(() => {
    return [...leads]
      .filter(isSubmittedLead)
      .sort(
        (a, b) =>
          Date.parse(b?.updatedAt || b?.createdAt || "") -
          Date.parse(a?.updatedAt || a?.createdAt || "")
      )
      .slice(0, 5);
  }, [leads]);
  const lastConversations = useMemo(() => {
    return [...sessions]
      .sort(
        (a, b) =>
          Date.parse(b?.updatedAt || b?.createdAt || "") -
          Date.parse(a?.updatedAt || a?.createdAt || "")
      )
      .slice(0, 5)
      .map((session, idx) => {
        const messages = Array.isArray(session?.messages) ? session.messages : [];
        const lastMessage = messages[messages.length - 1];
        return {
          id: session?.id || `chat-${idx + 1}`,
          preview:
            typeof lastMessage?.content === "string" && lastMessage.content.trim()
              ? lastMessage.content.trim()
              : "No messages yet.",
          count: Number(session?.messageCount) || 0,
          mode: session?.liveAgentEnabled ? "Live Agent" : "AI Managed",
          updatedAt: session?.updatedAt || session?.createdAt || "",
        };
      });
  }, [sessions]);

  return (
    <div className="dashboard-page relative grid min-h-0 w-full grid-cols-1 gap-5 xl:h-full xl:min-h-0 xl:flex-1 xl:grid-cols-[1fr_300px]">
      <main className="min-h-0 space-y-5 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                DIY Chatbot Command Center
              </h1>
              <p className="mt-1 text-sm text-slate-400">{overviewDateLabel} . Workspace Overview</p>
            </div>
            <div
              title={waDetailLine}
              className={`inline-flex max-w-[min(100%,280px)] flex-col gap-0.5 rounded-xl border px-3 py-2 sm:max-w-xs ${
                waConnected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                <MessageCircle size={14} className="shrink-0 opacity-80" aria-hidden />
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    waConnected ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="truncate">
                  WhatsApp {waConnected ? "connected" : "not connected"}
                </span>
              </span>
              <span className="truncate pl-6 text-[11px] font-medium leading-tight text-slate-600">
                {waDetailLine}
              </span>
            </div>
          </header>

          <section className="relative grid overflow-hidden rounded-3xl bg-gradient-to-r from-[#9A6BEB] via-[#8B5CF6] to-[#A78BFA] p-7 text-white shadow-[0_20px_40px_rgba(139,92,246,0.35)] lg:grid-cols-[1fr_220px] lg:items-center">
            <div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
            <div className="absolute right-6 top-4 h-16 w-16 rounded-2xl bg-white/15" />
            <div className="relative z-10">
              <p className="text-3xl font-semibold">Hello, {displayName}</p>
              <p className="mt-2 max-w-xl text-sm text-white/85">
                Your workspace has {liveConversationCount} tracked conversations, {liveLeadCount} collected leads,
                and {liveAgentSessions} live-agent sessions.
              </p>
            </div>
            <img
              src={dashboardHero}
              alt="Dashboard visual"
              className="relative z-10 mt-4 h-36 w-full object-contain object-center lg:mt-0"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-stretch">
            <article className="flex min-h-0 flex-col rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5 lg:h-full">
              <div className="mb-4 flex shrink-0 items-center justify-between">
                <p className="text-lg font-semibold text-slate-800">Conversations</p>
                <p className="text-xs text-slate-400">Messages / Day</p>
              </div>
              <div className="h-48 min-h-0 lg:h-auto lg:flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activityDataLive}>
                    <defs>
                      <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE8FF" />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid #ECE3FF",
                        backgroundColor: "#FFFFFF",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#8B5CF6"
                      strokeWidth={3}
                      fill="url(#activityGradient)"
                      dot={{ fill: "#FB923C", strokeWidth: 0, r: 4 }}
                      activeDot={{ r: 6, fill: "#FB923C" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>

            <div className="space-y-4">
              <article className="rounded-2xl border border-[#EEE8FF] bg-gradient-to-b from-white to-[#FAF7FF] p-5 shadow-[0_1px_0_rgba(139,92,246,0.06)]">
                <div>
                  <p className="text-lg font-semibold text-slate-800">Bot Deployment</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-400">Live agent vs AI managed sessions</p>
                </div>
                <div className="relative mx-auto mt-4 h-40 w-full max-w-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                      <defs>
                        <linearGradient id="deployRingPrimary" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#C4B5FD" />
                          <stop offset="45%" stopColor="#8B5CF6" />
                          <stop offset="100%" stopColor="#6D28D9" />
                        </linearGradient>
                        <linearGradient id="deployRingTrack" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#F5F3FF" />
                          <stop offset="100%" stopColor="#EDE9FE" />
                        </linearGradient>
                      </defs>
                      <Pie
                        data={deploymentDataLive}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="62%"
                        outerRadius="92%"
                        startAngle={92}
                        endAngle={-268}
                        paddingAngle={3}
                        cornerRadius={6}
                        stroke="#FFFFFF"
                        strokeWidth={3}
                      >
                        <Cell fill="url(#deployRingPrimary)" />
                        <Cell fill="url(#deployRingTrack)" />
                      </Pie>
                      <Tooltip
                        cursor={false}
                        formatter={(value, name) => [`${value}%`, name]}
                        contentStyle={{
                          borderRadius: "12px",
                          border: "1px solid #ECE3FF",
                          backgroundColor: "rgba(255, 255, 255, 0.96)",
                          boxShadow: "0 12px 40px rgba(109, 40, 217, 0.12)",
                          fontSize: "12px",
                          padding: "8px 12px",
                        }}
                        labelStyle={{ color: "#64748B", fontWeight: 600, marginBottom: 4 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[1.65rem] font-bold leading-none tracking-tight text-slate-900">
                      {liveAgentPercent}%
                    </span>
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Live Agent
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-2 ring-white"
                      style={{
                        background: "linear-gradient(145deg, #C4B5FD 0%, #6D28D9 100%)",
                      }}
                    />
                    Live agent ({liveAgentSessions})
                  </span>
                  <span className="flex items-center gap-2 text-slate-500">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#EDE9FE] ring-2 ring-white" />
                    AI managed ({aiManagedSessions})
                  </span>
                </div>
              </article>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-4">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                    <UsersRound size={12} />
                    Builders
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-800">{buildersCount}</p>
                </div>
                <div className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-4">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                    <Briefcase size={12} />
                    Conversations
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-800">{liveConversationCount}</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Chatbot Solutions</p>
              <p className="text-sm text-slate-400">Templates . Flows . Integrations</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {projectsLive.map((project) => (
                <article
                  key={project.title}
                  className="rounded-2xl border border-[#EEE7FF] bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div
                    className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${project.tone}`}
                  >
                    <project.icon size={16} className="text-[#8B5CF6]" />
                  </div>
                  <h3 className="font-semibold text-slate-800">{project.title}</h3>
                  <p className="mt-1 text-xs text-slate-400">{project.count}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-semibold text-slate-800">Lead Conversion Trend</p>
                <p className="text-xs text-slate-400">Submitted details vs total chats</p>
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={leadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE8FF" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <Tooltip />
                    <Legend iconType="circle" />
                    <Line
                      type="monotone"
                      dataKey="submitted"
                      stroke="#8B5CF6"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#8B5CF6" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalChats"
                      stroke="#FB923C"
                      strokeWidth={2}
                      strokeDasharray="6 5"
                      dot={{ r: 3, fill: "#FB923C" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-semibold text-slate-800">Channel Throughput</p>
                <p className="text-xs text-slate-400">AI-managed vs Live Agent by channel</p>
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workloadDataLive} barGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEE8FF" />
                    <XAxis dataKey="team" tick={{ fontSize: 12, fill: "#94A3B8" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#94A3B8" }} allowDecimals={false} />
                    <Tooltip />
                    <Legend iconType="circle" />
                    <Bar
                      dataKey="done"
                      name="AI-managed"
                      fill="#8B5CF6"
                      radius={[8, 8, 0, 0]}
                    />
                    <Bar
                      dataKey="pending"
                      name="Live Agent"
                      fill="#FB923C"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-semibold text-slate-800">Recent Inquiries</p>
              <p className="text-xs text-slate-400">Latest 5 leads</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-left">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Quality of leads</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInquiryRows.map((row) => (
                    <tr key={row.id || `${row.conversationId}-${row.updatedAt}`} className="rounded-xl bg-white shadow-sm">
                      <td className="rounded-l-xl px-3 py-3 text-sm font-semibold text-slate-700">
                        {getByLabelLike(row, /name|full\s*name/i)}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">{getByLabelLike(row, /email/i)}</td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        {getByLabelLike(row, /phone|mobile|contact/i)}
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-600">
                        <LeadQualityCell row={row} />
                      </td>
                      <td className="px-3 py-3 text-sm text-slate-500">
                        {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="rounded-r-xl px-3 py-3">
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
                  {visibleInquiryRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                        No inquiries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-center border-t border-[#EEE8FF] pt-4">
              <button
                type="button"
                onClick={() => navigate("/inquiries")}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
              >
                All inquiries
                <ChevronRight size={16} className="opacity-90" aria-hidden />
              </button>
            </div>
          </section>
      </main>

      <aside className="min-h-0 space-y-5 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-900">My Profile</p>
              <p className="text-xs text-slate-400">Workspace owner</p>
            </div>
            <button type="button" className="text-slate-400">
              <MoreHorizontal size={16} />
            </button>
          </div>

          <div className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5 text-center">
            <img
              src={avatarZaenal}
              alt={displayName}
              className="mx-auto h-20 w-20 rounded-full border-4 border-[#FB923C]"
            />
            <p className="mt-4 font-semibold text-slate-900">{displayName}</p>
            <p className="text-xs text-slate-400">{displayEmail}</p>
          </div>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F4ECFF] text-[#8B5CF6]">
                <Bot size={22} strokeWidth={1.5} aria-hidden />
              </div>
              <p className="min-w-0 flex-1 text-lg font-semibold text-slate-900">AI Agent Control</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#E9DFFF] bg-white px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-800">Generate AI replies</span>
              <button
                type="button"
                role="switch"
                aria-checked={widgetSettings ? widgetSettings.aiRepliesEnabled !== false : true}
                disabled={!widgetSettings || aiControlSaving || !userId}
                onClick={() => void toggleAiReplies(!(widgetSettings?.aiRepliesEnabled !== false))}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  widgetSettings?.aiRepliesEnabled !== false ? "bg-[#8B5CF6]" : "bg-slate-300"
                } ${!widgetSettings || aiControlSaving ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    widgetSettings?.aiRepliesEnabled !== false ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </section>

          <section>
            <div className="mb-3">
              <p className="text-lg font-semibold text-slate-900">Last Conversations</p>
            </div>
            <div className="space-y-3">
              {lastConversations.map((chat) => (
                <div
                  key={chat.id}
                  className="rounded-xl border border-[#EEE8FF] bg-[#FDFCFF] p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <ClipboardList size={14} className="text-[#8B5CF6]" />
                      {chat.count} messages
                    </p>
                    <span className="rounded-full bg-[#F4ECFF] px-2 py-1 text-[10px] font-semibold uppercase text-[#8B5CF6]">
                      {chat.mode}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{chat.preview}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : "—"}
                  </p>
                </div>
              ))}
              {lastConversations.length === 0 ? (
                <div className="rounded-xl border border-[#EEE8FF] bg-[#FDFCFF] p-3 text-xs text-slate-500">
                  No conversations yet.
                </div>
              ) : null}
            </div>
          </section>

      </aside>

      {liveDataError ? (
        <div className="fixed bottom-4 right-4 z-40 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-md">
          {liveDataError}
        </div>
      ) : null}

      {loginPopup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-login-popup-title"
          onClick={() => setLoginPopup(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#E9D5FF] bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="workspace-login-popup-title" className="text-xl font-bold text-slate-900">
              Welcome back
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {loginPopup.userLabel
                ? `You are now logged in as ${loginPopup.userLabel}.`
                : "You are now logged in to the workspace dashboard."}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setLoginPopup(null)}
                className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Dashboard;
