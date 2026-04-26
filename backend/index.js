const fs = require("fs");
const http = require("http");
const path = require("path");
const dotenv = require("dotenv");
const { createWhatsAppBridge } = require("./whatsappBridge");
const whatsappAutoStart = require("./whatsappAutoStart");

// Load `backend/.env` even when Node is started from the repo root (dotenv default is cwd-only).
dotenv.config({ path: path.join(__dirname, ".env") });

const readEnvCredential = (key) => {
  const raw = process.env[key];
  if (typeof raw !== "string") return "";
  return raw.replace(/^\uFEFF/, "").trim();
};

const PORT = Number(process.env.PORT) || 1248;
const ADMIN_USERNAME = readEnvCredential("ADMIN_USERNAME");
const ADMIN_PASSWORD = readEnvCredential("ADMIN_PASSWORD");

const adminCorsHeaders = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ACCOUNTS_PATH = path.join(__dirname, "data", "accounts.json");
const METRICS_PATH = path.join(__dirname, "data", "metrics.json");
const CHATS_PATH = path.join(__dirname, "data", "chats.json");
const LEADS_PATH = path.join(__dirname, "data", "leads.json");
const WIDGET_SETTINGS_PATH = path.join(__dirname, "data", "widgetSettings.json");
const AGENT_DETAILS_PATH = path.join(__dirname, "data", "agentDetails.json");
const AGENT_DETAILS_BY_USER_DIR = path.join(__dirname, "data", "agentDetailsUsers");
const FRONTEND_BUILD_DIR = path.join(__dirname, "..", "frontend", "build");
const FRONTEND_INDEX_PATH = path.join(FRONTEND_BUILD_DIR, "index.html");
/** Previous location; copied into `data/` on first access if present. */
const LEGACY_AGENT_DETAILS_PATH = path.join(__dirname, "dta", "agentDetails.json");
const LEGACY_AGENT_DETAILS_BY_USER_DIR = path.join(__dirname, "dta", "agentDetails");
const ALLOWED_PLANS = new Set(["Test", "Trial", "Basic", "Pro"]);
const ALLOWED_STATUS = new Set(["Active", "Inactive"]);
const PLAN_TRIAL_DAYS = {
  Test: 7,
  Trial: 30,
};

const adminAuthConfigured = () =>
  typeof ADMIN_USERNAME === "string" &&
  typeof ADMIN_PASSWORD === "string" &&
  ADMIN_USERNAME.length > 0 &&
  ADMIN_PASSWORD.length > 0;

const sendJson = (res, statusCode, payload, extraHeaders = {}) => {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const serveFile = (res, absolutePath, headers = {}) => {
  try {
    const content = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, ...headers });
    res.end(content);
    return true;
  } catch {
    return false;
  }
};

/** Web-style path `/static/...` for cache rules (handles Windows-normalized `\`). */
const webPathFromNormalized = (normalized) =>
  normalized.replace(/\\/g, "/").startsWith("/")
    ? normalized.replace(/\\/g, "/")
    : `/${normalized.replace(/\\/g, "/")}`;

const cacheHeadersForFrontendFile = (normalizedOsPath, absolutePath) => {
  const webPath = webPathFromNormalized(normalizedOsPath);
  const base = path.basename(absolutePath);
  const isFingerprinted =
    /^[\w.-]+?\.[a-f0-9]{8,}\.(js|css)$/i.test(base);
  if (webPath.startsWith("/static/js/") || webPath.startsWith("/static/css/")) {
    return isFingerprinted
      ? { "Cache-Control": "public, max-age=31536000, immutable" }
      : { "Cache-Control": "public, max-age=3600" };
  }
  return { "Cache-Control": "public, max-age=86400" };
};

const tryServeFrontendBuild = (reqPath, res) => {
  if (!fs.existsSync(FRONTEND_INDEX_PATH)) return false;
  const indexHeaders = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };
  if (reqPath === "/") {
    return serveFile(res, FRONTEND_INDEX_PATH, indexHeaders);
  }
  let decoded = reqPath;
  try {
    decoded = decodeURIComponent(reqPath);
  } catch {
    decoded = reqPath;
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.join(FRONTEND_BUILD_DIR, normalized);
  if (candidate.startsWith(FRONTEND_BUILD_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return serveFile(res, candidate, cacheHeadersForFrontendFile(normalized, candidate));
  }
  // Only use SPA fallback for route-like paths. For missing assets (`.js`, `.css`, etc.),
  // returning index.html causes browser parse errors like "Unexpected token '<'".
  const requestedExt = path.extname(normalized);
  if (requestedExt) {
    return sendJson(res, 404, { message: "Frontend asset not found" });
  }
  return serveFile(res, FRONTEND_INDEX_PATH, indexHeaders);
};

const ensureAccountsFile = () => {
  const dir = path.dirname(ACCOUNTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    fs.writeFileSync(ACCOUNTS_PATH, "[]", "utf8");
  }
};

const readAccounts = () => {
  ensureAccountsFile();
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, "utf8");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const writeAccounts = (accounts) => {
  ensureAccountsFile();
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), "utf8");
};

const ensureChatsFile = () => {
  const dir = path.dirname(CHATS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CHATS_PATH)) {
    fs.writeFileSync(CHATS_PATH, JSON.stringify({ sessions: [] }, null, 2), "utf8");
  }
};

const readChatsStore = () => {
  ensureChatsFile();
  try {
    const raw = fs.readFileSync(CHATS_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (error) {
    return { sessions: [] };
  }
};

const writeChatsStore = (store) => {
  ensureChatsFile();
  const payload = {
    sessions: Array.isArray(store?.sessions) ? store.sessions : [],
  };
  fs.writeFileSync(CHATS_PATH, JSON.stringify(payload, null, 2), "utf8");
};

const ensureLeadsFile = () => {
  const dir = path.dirname(LEADS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LEADS_PATH)) {
    fs.writeFileSync(LEADS_PATH, JSON.stringify({ leads: [] }, null, 2), "utf8");
  }
};

const readLeadsStore = () => {
  ensureLeadsFile();
  try {
    const raw = fs.readFileSync(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
    };
  } catch (error) {
    return { leads: [] };
  }
};

const writeLeadsStore = (store) => {
  ensureLeadsFile();
  const payload = {
    leads: Array.isArray(store?.leads) ? store.leads : [],
  };
  fs.writeFileSync(LEADS_PATH, JSON.stringify(payload, null, 2), "utf8");
};

const getDefaultWidgetSettings = () => ({
  primaryColor: "#7C3AED",
  accentColor: "#A78BFA",
  backgroundColor: "#FCFAFF",
  textColor: "#0F172A",
  headerColor: "#7C3AED",
  senderMessageBgColor: "#7C3AED",
  senderMessageTextColor: "#FFFFFF",
  receiverMessageBgColor: "#FFFFFF",
  receiverMessageTextColor: "#1E293B",
  sendButtonColor: "#7C3AED",
  launcherImage: "",
  /** When false, POST /chat/test does not generate assistant replies (all channels). */
  aiRepliesEnabled: true,
  updatedAt: null,
});

const ensureWidgetSettingsFile = () => {
  const dir = path.dirname(WIDGET_SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(WIDGET_SETTINGS_PATH)) {
    fs.writeFileSync(WIDGET_SETTINGS_PATH, JSON.stringify({ users: {} }, null, 2), "utf8");
  }
};

const readWidgetSettingsStore = () => {
  ensureWidgetSettingsFile();
  try {
    const raw = fs.readFileSync(WIDGET_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      users: parsed?.users && typeof parsed.users === "object" ? parsed.users : {},
    };
  } catch (error) {
    return { users: {} };
  }
};

const writeWidgetSettingsStore = (store) => {
  ensureWidgetSettingsFile();
  const payload = {
    users: store?.users && typeof store.users === "object" ? store.users : {},
  };
  fs.writeFileSync(WIDGET_SETTINGS_PATH, JSON.stringify(payload, null, 2), "utf8");
};

const getDefaultAgentDetails = () => ({
  basicDetails: "",
  companyDetails: "",
  contactEmail: "",
  contactPhone: "",
  contactWebsite: "",
  contactAddress: "",
  productsOrServices: [],
  agentTargets: "",
  fieldsToCollectEnabled: false,
  fieldsToCollect: [],
  otherDetails: "",
  updatedAt: null,
});

const clampAgentDetailString = (value, maxLen) => {
  const s = typeof value === "string" ? value.trim() : "";
  return s.slice(0, maxLen);
};

const migrateLegacyAgentDetailsFile = () => {
  try {
    if (!fs.existsSync(AGENT_DETAILS_PATH) && fs.existsSync(LEGACY_AGENT_DETAILS_PATH)) {
      const dir = path.dirname(AGENT_DETAILS_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(LEGACY_AGENT_DETAILS_PATH, AGENT_DETAILS_PATH);
    }
  } catch (error) {
    /* ignore migration failures */
  }
};

const ensureAgentDetailsFile = () => {
  const dir = path.dirname(AGENT_DETAILS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  migrateLegacyAgentDetailsFile();
  if (!fs.existsSync(AGENT_DETAILS_PATH)) {
    fs.writeFileSync(
      AGENT_DETAILS_PATH,
      JSON.stringify(getDefaultAgentDetails(), null, 2),
      "utf8"
    );
  }
};

const sanitizeAgentDetailsUserId = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return "";
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "";
  return trimmed;
};

const sanitizeConversationId = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return "";
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "";
  return trimmed;
};

const sanitizeHexColor = (value, fallback) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  return fallback;
};

const sanitizeWidgetSettings = (input) => {
  const defaults = getDefaultWidgetSettings();
  const source = input && typeof input === "object" ? input : {};
  const rawLauncherImage = typeof source.launcherImage === "string" ? source.launcherImage.trim() : "";
  const launcherImage =
    rawLauncherImage &&
    rawLauncherImage.length <= 450000 &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(rawLauncherImage)
      ? rawLauncherImage
      : "";
  const aiRepliesEnabled =
    typeof source.aiRepliesEnabled === "boolean"
      ? source.aiRepliesEnabled
      : defaults.aiRepliesEnabled;
  return {
    primaryColor: sanitizeHexColor(source.primaryColor, defaults.primaryColor),
    accentColor: sanitizeHexColor(source.accentColor, defaults.accentColor),
    backgroundColor: sanitizeHexColor(source.backgroundColor, defaults.backgroundColor),
    textColor: sanitizeHexColor(source.textColor, defaults.textColor),
    headerColor: sanitizeHexColor(source.headerColor, defaults.headerColor),
    senderMessageBgColor: sanitizeHexColor(source.senderMessageBgColor, defaults.senderMessageBgColor),
    senderMessageTextColor: sanitizeHexColor(source.senderMessageTextColor, defaults.senderMessageTextColor),
    receiverMessageBgColor: sanitizeHexColor(source.receiverMessageBgColor, defaults.receiverMessageBgColor),
    receiverMessageTextColor: sanitizeHexColor(source.receiverMessageTextColor, defaults.receiverMessageTextColor),
    sendButtonColor: sanitizeHexColor(source.sendButtonColor, defaults.sendButtonColor),
    launcherImage,
    aiRepliesEnabled,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
  };
};

const readWidgetSettings = (userIdRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  if (!safeUserId) return getDefaultWidgetSettings();
  const store = readWidgetSettingsStore();
  const raw = store.users?.[safeUserId];
  return { ...getDefaultWidgetSettings(), ...sanitizeWidgetSettings(raw) };
};

const writeWidgetSettings = (userIdRaw, settingsRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  if (!safeUserId) return null;
  const store = readWidgetSettingsStore();
  const settings = {
    ...sanitizeWidgetSettings(settingsRaw),
    updatedAt: new Date().toISOString(),
  };
  store.users[safeUserId] = settings;
  writeWidgetSettingsStore(store);
  return settings;
};

const sanitizeSessionChatMessages = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const role =
      entry?.role === "assistant"
        ? "assistant"
        : entry?.role === "user"
        ? "user"
        : entry?.role === "agent"
        ? "agent"
        : null;
    const content = typeof entry?.content === "string" ? entry.content.trim() : "";
    if (!role || !content) continue;
    const msg = { role, content: content.slice(0, 16000) };
    if (role === "assistant") {
      const att = sanitizeMessageAttachments(entry.attachments);
      if (att.length) msg.attachments = att;
    }
    out.push(msg);
  }
  return out.slice(-60);
};

const normalizeFieldKey = (label) =>
  String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);

const sanitizeCollectedFields = (fieldLabels, rawData) => {
  const allowed = Array.isArray(fieldLabels) ? fieldLabels : [];
  const byKey = new Map(allowed.map((label) => [normalizeFieldKey(label), String(label)]));
  const out = {};
  if (!rawData || typeof rawData !== "object") return out;
  for (const [key, value] of Object.entries(rawData)) {
    const normalized = normalizeFieldKey(key);
    const targetLabel = byKey.get(normalized);
    if (!targetLabel) continue;
    const cleaned = typeof value === "string" ? value.trim() : "";
    if (!cleaned) continue;
    out[targetLabel] = cleaned.slice(0, 500);
  }
  return out;
};

const getLeadByConversation = (userIdRaw, conversationIdRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  if (!safeUserId || !safeConversationId) return null;
  const store = readLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  return (
    leads.find(
      (lead) =>
        String(lead.userId || "") === safeUserId &&
        String(lead.conversationId || "") === safeConversationId
    ) || null
  );
};

const upsertLeadByConversation = (userIdRaw, conversationIdRaw, fieldLabels, collectedFields) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  if (!safeUserId || !safeConversationId) return null;

  const sanitizedCollected = sanitizeCollectedFields(fieldLabels, collectedFields);
  const nowIso = new Date().toISOString();
  const store = readLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  const idx = leads.findIndex(
    (lead) =>
      String(lead.userId || "") === safeUserId &&
      String(lead.conversationId || "") === safeConversationId
  );

  const payload = {
    id: idx >= 0 ? leads[idx].id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: safeUserId,
    conversationId: safeConversationId,
    fieldLabels: Array.isArray(fieldLabels) ? fieldLabels : [],
    collectedData: sanitizedCollected,
    collectedCount: Object.keys(sanitizedCollected).length,
    updatedAt: nowIso,
  };

  if (idx >= 0) {
    payload.createdAt = typeof leads[idx].createdAt === "string" ? leads[idx].createdAt : nowIso;
    leads[idx] = payload;
  } else {
    payload.createdAt = nowIso;
    leads.unshift(payload);
  }

  writeLeadsStore({ leads: leads.slice(0, 1000) });
  return payload;
};

const getLeadsForUser = (userIdRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  if (!safeUserId) return [];
  const store = readLeadsStore();
  const leads = Array.isArray(store.leads) ? store.leads : [];
  return leads
    .filter((lead) => String(lead.userId || "") === safeUserId)
    .map((lead) => ({
      id: typeof lead.id === "string" ? lead.id : `${Date.now()}`,
      userId: safeUserId,
      conversationId:
        typeof lead.conversationId === "string" ? sanitizeConversationId(lead.conversationId) : "",
      fieldLabels: Array.isArray(lead.fieldLabels) ? lead.fieldLabels : [],
      collectedData: lead.collectedData && typeof lead.collectedData === "object" ? lead.collectedData : {},
      collectedCount: Number(lead.collectedCount) || 0,
      createdAt: typeof lead.createdAt === "string" ? lead.createdAt : null,
      updatedAt: typeof lead.updatedAt === "string" ? lead.updatedAt : null,
    }))
    .filter((lead) => Boolean(lead.conversationId))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
};

const extractCollectedFieldsHeuristic = (fieldLabels, chatMessages, existing = {}) => {
  const out = { ...sanitizeCollectedFields(fieldLabels, existing) };
  const userTranscript = (Array.isArray(chatMessages) ? chatMessages : [])
    .filter((m) => m?.role === "user" && typeof m?.content === "string")
    .map((m) => m.content)
    .join("\n");
  const transcript = userTranscript.slice(-12000);

  for (const label of fieldLabels) {
    if (out[label]) continue;
    const normalized = normalizeFieldKey(label);

    if (normalized.includes("email")) {
      const match = transcript.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (match?.[0]) out[label] = match[0];
      continue;
    }
    if (normalized.includes("phone") || normalized.includes("mobile") || normalized.includes("contact")) {
      const match = transcript.match(/(\+?\d[\d\s\-()]{7,}\d)/);
      if (match?.[0]) out[label] = match[0].trim();
      continue;
    }

    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = transcript.match(new RegExp(`${escaped}\\s*[:\\-]\\s*(.+)`, "i"));
    if (direct?.[1]) out[label] = direct[1].trim().slice(0, 500);
  }
  return sanitizeCollectedFields(fieldLabels, out);
};

const extractCollectedFieldsWithOpenAI = async (fieldLabels, chatMessages, existing = {}) => {
  const apiKey = readEnvCredential("OPENAI_API_KEY");
  if (!apiKey || !fieldLabels.length) return extractCollectedFieldsHeuristic(fieldLabels, chatMessages, existing);

  const transcript = chatMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(-10000);
  const current = sanitizeCollectedFields(fieldLabels, existing);
  const model = readEnvCredential("OPENAI_MODEL") || "gpt-4o-mini";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 350,
        messages: [
          {
            role: "system",
            content:
              "Extract lead field values from chat. Return ONLY strict JSON object. Keys must match the provided field labels exactly. Use empty string for unknown values.",
          },
          {
            role: "user",
            content:
              `Field labels: ${fieldLabels.join(" | ")}\n\n` +
              `Existing collected JSON: ${JSON.stringify(current)}\n\n` +
              `Transcript:\n${transcript}\n\n` +
              "Return JSON only.",
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return extractCollectedFieldsHeuristic(fieldLabels, chatMessages, existing);
    const text = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return extractCollectedFieldsHeuristic(fieldLabels, chatMessages, existing);
    }
    const parsed = JSON.parse(text.slice(start, end + 1));
    return sanitizeCollectedFields(fieldLabels, { ...current, ...parsed });
  } catch (error) {
    return extractCollectedFieldsHeuristic(fieldLabels, chatMessages, existing);
  }
};

const CHAT_SOURCES_ALLOWED = new Set(["test_bot", "web", "whatsapp"]);

const sanitizeChatSource = (raw) => {
  const s = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (s === "test" || s === "testbot") return "test_bot";
  if (CHAT_SOURCES_ALLOWED.has(s)) return s;
  return "test_bot";
};

const sanitizeChannelAccountName = (raw) => {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 120);
};

const resolveSessionChatSource = (existingSession, options) => {
  if (options && options.chatSource !== undefined) return sanitizeChatSource(options.chatSource);
  if (existingSession && existingSession.chatSource)
    return sanitizeChatSource(existingSession.chatSource);
  return "test_bot";
};

const resolveSessionChannelAccountName = (existingSession, options) => {
  if (options && options.channelAccountName !== undefined)
    return sanitizeChannelAccountName(options.channelAccountName);
  if (existingSession && typeof existingSession.channelAccountName === "string")
    return sanitizeChannelAccountName(existingSession.channelAccountName);
  return "";
};

const sanitizeWhatsappChatId = (raw) => {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 120);
};

const resolveSessionWhatsappChatId = (existingSession, options) => {
  if (options && options.whatsappChatId !== undefined) return sanitizeWhatsappChatId(options.whatsappChatId);
  if (existingSession && typeof existingSession.whatsappChatId === "string")
    return sanitizeWhatsappChatId(existingSession.whatsappChatId);
  return "";
};

const saveTestChatSession = (userIdRaw, conversationIdRaw, messages, options = {}) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  if (!safeConversationId) return;
  const sessionUserId = safeUserId || "__anonymous__";
  const accounts = readAccounts();
  const matchedAccount = safeUserId
    ? accounts.find((entry) => String(entry.id || "").trim() === safeUserId)
    : null;

  const nowIso = new Date().toISOString();
  const conversation = sanitizeSessionChatMessages(messages);

  const store = readChatsStore();
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const existingIndex = sessions.findIndex(
    (session) =>
      String(session.userId || "") === sessionUserId &&
      String(session.conversationId || "") === safeConversationId
  );

  const accountRef = matchedAccount
    ? {
        id: String(matchedAccount.id || ""),
        username: String(matchedAccount.username || ""),
        email: String(matchedAccount.email || ""),
      }
    : null;

  const prevSession = existingIndex >= 0 ? sessions[existingIndex] : null;
  const chatSource = resolveSessionChatSource(prevSession, options);
  const channelAccountName = resolveSessionChannelAccountName(prevSession, options);
  const whatsappChatId = resolveSessionWhatsappChatId(prevSession, options);

  if (existingIndex >= 0) {
    sessions[existingIndex] = {
      ...sessions[existingIndex],
      userId: sessionUserId,
      conversationId: safeConversationId,
      account: accountRef,
      chatSource,
      channelAccountName,
      whatsappChatId,
      messages: conversation,
      messageCount: conversation.length,
      liveAgentEnabled: Boolean(
        typeof options.liveAgentEnabled === "boolean"
          ? options.liveAgentEnabled
          : sessions[existingIndex].liveAgentEnabled
      ),
      lastReplyPreview: conversation[conversation.length - 1]?.content?.slice(0, 300) || "",
      updatedAt: nowIso,
    };
  } else {
    sessions.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: sessionUserId,
      conversationId: safeConversationId,
      account: accountRef,
      chatSource,
      channelAccountName,
      whatsappChatId,
      messages: conversation,
      messageCount: conversation.length,
      liveAgentEnabled: Boolean(options.liveAgentEnabled),
      lastReplyPreview: conversation[conversation.length - 1]?.content?.slice(0, 300) || "",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  writeChatsStore({ sessions: sessions.slice(0, 200) });
};

const getTestChatSessionsForUser = (userIdRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  if (!safeUserId) return [];
  const store = readChatsStore();
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  return sessions
    .filter((session) => String(session.userId || "") === safeUserId)
    .map((session) => {
      const conversationId =
        typeof session.conversationId === "string" ? sanitizeConversationId(session.conversationId) : "";
      const lead = conversationId ? getLeadByConversation(safeUserId, conversationId) : null;
      return {
        id: typeof session.id === "string" ? session.id : `${Date.now()}`,
        userId: safeUserId,
        conversationId,
        account: session.account && typeof session.account === "object" ? session.account : null,
        chatSource: sanitizeChatSource(session.chatSource),
        channelAccountName: sanitizeChannelAccountName(session.channelAccountName),
        whatsappChatId:
          typeof session.whatsappChatId === "string" ? sanitizeWhatsappChatId(session.whatsappChatId) : "",
        messages: sanitizeSessionChatMessages(session.messages),
        messageCount: Number(session.messageCount) || 0,
        liveAgentEnabled: Boolean(session.liveAgentEnabled),
        lastReplyPreview:
          typeof session.lastReplyPreview === "string" ? session.lastReplyPreview : "",
        lead: lead
          ? {
              fieldLabels: Array.isArray(lead.fieldLabels) ? lead.fieldLabels : [],
              collectedData: lead.collectedData && typeof lead.collectedData === "object" ? lead.collectedData : {},
              collectedCount: Number(lead.collectedCount) || 0,
              updatedAt: typeof lead.updatedAt === "string" ? lead.updatedAt : null,
            }
          : null,
        createdAt: typeof session.createdAt === "string" ? session.createdAt : null,
        updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : null,
      };
    })
    .filter((session) => Boolean(session.conversationId))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
};

const getTestChatSessionByConversation = (userIdRaw, conversationIdRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  if (!safeUserId || !safeConversationId) return null;
  const sessions = getTestChatSessionsForUser(safeUserId);
  return (
    sessions.find(
      (session) =>
        String(session.userId || "") === safeUserId &&
        String(session.conversationId || "") === safeConversationId
    ) || null
  );
};

const updateLiveAgentMode = (userIdRaw, conversationIdRaw, enabled) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  if (!safeUserId || !safeConversationId) return null;

  const existing = getTestChatSessionByConversation(safeUserId, safeConversationId);
  if (!existing) return null;
  saveTestChatSession(safeUserId, safeConversationId, existing.messages, {
    liveAgentEnabled: Boolean(enabled),
  });
  return getTestChatSessionByConversation(safeUserId, safeConversationId);
};

const appendLiveAgentMessage = (userIdRaw, conversationIdRaw, messageTextRaw) => {
  const safeUserId = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  const safeConversationId = sanitizeConversationId(
    typeof conversationIdRaw === "string" ? conversationIdRaw : String(conversationIdRaw || "")
  );
  const messageText = typeof messageTextRaw === "string" ? messageTextRaw.trim() : "";
  if (!safeUserId || !safeConversationId || !messageText) return null;
  const existing = getTestChatSessionByConversation(safeUserId, safeConversationId);
  if (!existing || !existing.liveAgentEnabled) return null;

  const nextMessages = [...existing.messages, { role: "agent", content: messageText }];
  saveTestChatSession(safeUserId, safeConversationId, nextMessages, {
    liveAgentEnabled: true,
  });
  return getTestChatSessionByConversation(safeUserId, safeConversationId);
};

const resolveAgentDetailsPath = (userIdRaw) => {
  const safe = sanitizeAgentDetailsUserId(
    typeof userIdRaw === "string" ? userIdRaw : String(userIdRaw || "")
  );
  if (safe) {
    if (!fs.existsSync(AGENT_DETAILS_BY_USER_DIR)) {
      fs.mkdirSync(AGENT_DETAILS_BY_USER_DIR, { recursive: true });
    }
    return path.join(AGENT_DETAILS_BY_USER_DIR, `${safe}.json`);
  }
  ensureAgentDetailsFile();
  return AGENT_DETAILS_PATH;
};

const MAX_PRODUCT_PDF_DATA_CHARS = 11_000_000;

const sanitizeProductsOrServices = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const attachmentKind = item?.attachmentKind === "pdf" ? "pdf" : "images";
      const rawImages = Array.isArray(item?.images)
        ? item.images
        : (typeof item?.imageData === "string" || typeof item?.imageName === "string")
        ? [{ imageName: item.imageName, imageData: item.imageData }]
        : [];
      const images =
        attachmentKind === "pdf"
          ? []
          : rawImages
              .map((image) => ({
                imageName: typeof image?.imageName === "string" ? image.imageName.trim() : "",
                imageData: typeof image?.imageData === "string" ? image.imageData.trim() : "",
              }))
              .filter((image) => image.imageData || image.imageName)
              .slice(0, 3);

      let pdf = null;
      if (attachmentKind === "pdf") {
        const pdfName = typeof item?.pdf?.pdfName === "string" ? item.pdf.pdfName.trim() : "";
        let pdfData = typeof item?.pdf?.pdfData === "string" ? item.pdf.pdfData.trim() : "";
        if (pdfData.length > MAX_PRODUCT_PDF_DATA_CHARS) {
          pdfData = "";
        }
        const looksPdf =
          /^data:application\/pdf/i.test(pdfData) || /^data:application\/x-pdf/i.test(pdfData);
        if (pdfName && pdfData && looksPdf) {
          pdf = { pdfName, pdfData };
        }
      }

      const outKind = pdf ? "pdf" : "images";
      return {
        title: typeof item?.title === "string" ? item.title.trim() : "",
        description:
          typeof item?.description === "string" ? item.description.trim() : "",
        attachmentKind: outKind,
        images: outKind === "pdf" ? [] : images,
        pdf: outKind === "pdf" ? pdf : null,
      };
    })
    .filter(
      (item) =>
        item.title ||
        item.description ||
        item.images.length > 0 ||
        (item.pdf && item.pdf.pdfData)
    );
};

const MAX_MESSAGE_ATTACHMENT_IMAGE_CHARS = 2_400_000;
const MAX_MESSAGE_ATTACHMENT_PDF_CHARS = MAX_PRODUCT_PDF_DATA_CHARS;
const MAX_MESSAGE_ATTACHMENTS = 8;
const MAX_MESSAGE_ATTACHMENT_IMAGES = 6;

const sanitizeMessageAttachments = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= MAX_MESSAGE_ATTACHMENTS) break;
    if (item?.kind === "pdf") {
      const pdfName =
        typeof item.pdfName === "string" && item.pdfName.trim()
          ? item.pdfName.trim().slice(0, 180)
          : "document.pdf";
      let pdfData = typeof item.pdfData === "string" ? item.pdfData.trim() : "";
      if (pdfData.length > MAX_MESSAGE_ATTACHMENT_PDF_CHARS) pdfData = "";
      const looksPdf =
        /^data:application\/pdf/i.test(pdfData) || /^data:application\/x-pdf/i.test(pdfData);
      if (!looksPdf) continue;
      const productTitle =
        typeof item.productTitle === "string" && item.productTitle.trim()
          ? item.productTitle.trim().slice(0, 200)
          : "";
      const row = { kind: "pdf", pdfName, pdfData };
      if (productTitle) row.productTitle = productTitle;
      out.push(row);
    } else if (item?.kind === "image") {
      const imageName =
        typeof item.imageName === "string" && item.imageName.trim()
          ? item.imageName.trim().slice(0, 180)
          : "";
      let imageData = typeof item.imageData === "string" ? item.imageData.trim() : "";
      if (imageData.length > MAX_MESSAGE_ATTACHMENT_IMAGE_CHARS) imageData = "";
      if (!/^data:image\/(png|jpeg|jpg|webp|gif)/i.test(imageData)) continue;
      const productTitle =
        typeof item.productTitle === "string" && item.productTitle.trim()
          ? item.productTitle.trim().slice(0, 200)
          : "";
      const row = { kind: "image", imageName, imageData };
      if (productTitle) row.productTitle = productTitle;
      out.push(row);
    }
  }
  return out;
};

/**
 * True when the visitor is asking for deeper detail about offerings or for visuals/docs—
 * not casual mentions ("Do you sell X?"). Attachments only send in this case.
 */
const visitorSeeksProductDetailDepth = (userMessage) => {
  const u = typeof userMessage === "string" ? userMessage.trim() : "";
  if (!u) return false;
  const s = u.toLowerCase();

  if (
    /\b(brochure|catalogue|catalog|datasheet|data\s*sheet|pdf|photo|photos|picture|pictures|image|images|screenshot|flyer|flyers|spec\s*sheet|attachments?|downloads?)\b/i.test(
      u
    )
  ) {
    return true;
  }
  if (/\b(show\s+me|let\s+me\s+see|can\s+i\s+see)\b/i.test(u)) return true;

  if (
    /\b(more\s+detail|more\s+details|more\s+information|more\s+info|tell\s+me\s+more|explain\s+(more|further)|in\s+(greater\s+)?detail|elaborate|expand|deeper|full\s+detail|comprehensive|thoroughly|everything\s+about)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(specification|specifications|specifics|specs)\b/i.test(u)) return true;
  if (/\bwhat\s+('?s|is)\s+included\b/i.test(s)) return true;
  if (/\b(how\s+does\s+it\s+work|walk\s+me\s+through)\b/i.test(s)) return true;
  if (/\bdescribe\b/i.test(u)) return true;

  return false;
};

/**
 * When the visitor sought deeper detail and the thread references a product/service card
 * that has images or a PDF, include those files in the chat response.
 */
const collectWorkspaceProductAttachments = (productsOrServices, userMessage, assistantReply) => {
  const products = Array.isArray(productsOrServices) ? productsOrServices : [];

  if (!visitorSeeksProductDetailDepth(userMessage)) {
    return [];
  }

  const haystack = `${typeof userMessage === "string" ? userMessage : ""}\n${
    typeof assistantReply === "string" ? assistantReply : ""
  }`.toLowerCase();

  const tokenize = (text) =>
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length >= 2);

  const descriptionKeywordMatch = (desc) => {
    const words = String(desc || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length >= 4);
    return words.some((w) => haystack.includes(w));
  };

  const productMatches = (item) => {
    const title = String(item.title || "").trim().toLowerCase();
    if (title && haystack.includes(title)) return true;
    const words = tokenize(item.title);
    if (words.length === 1) return haystack.includes(words[0]);
    const hits = words.filter((w) => haystack.includes(w));
    if (words.length <= 3) return hits.length >= 1;
    return hits.length >= 2;
  };

  let matched = products.filter((p) => productMatches(p) || descriptionKeywordMatch(p.description));

  if (matched.length === 0) {
    const withPdf = products.filter((p) => p.pdf?.pdfData);
    if (withPdf.length === 1) matched = [withPdf[0]];
    if (matched.length === 0) {
      const withImg = products.filter((p) => Array.isArray(p.images) && p.images.length > 0);
      if (withImg.length === 1) matched = [withImg[0]];
    }
  }

  const attachments = [];
  let imageCount = 0;

  for (const p of matched) {
    const title = String(p.title || "").trim();
    if (p.attachmentKind === "pdf" && p.pdf?.pdfData) {
      attachments.push({
        kind: "pdf",
        productTitle: title,
        pdfName: p.pdf.pdfName || "document.pdf",
        pdfData: p.pdf.pdfData,
      });
      continue;
    }
    const imgs = Array.isArray(p.images) ? p.images : [];
    for (const img of imgs) {
      if (imageCount >= MAX_MESSAGE_ATTACHMENT_IMAGES) break;
      const imageData = typeof img.imageData === "string" ? img.imageData.trim() : "";
      const imageName = typeof img.imageName === "string" ? img.imageName.trim() : "";
      if (!/^data:image\/(png|jpeg|jpg|webp|gif)/i.test(imageData)) continue;
      attachments.push({
        kind: "image",
        productTitle: title,
        imageName: imageName || "Image",
        imageData,
      });
      imageCount += 1;
    }
  }

  return sanitizeMessageAttachments(attachments);
};

const sanitizeFieldsToCollect = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const migrateLegacyPerUserAgentDetails = (safeUserId, destPath) => {
  if (!safeUserId || fs.existsSync(destPath)) return;
  const legacyPath = path.join(LEGACY_AGENT_DETAILS_BY_USER_DIR, `${safeUserId}.json`);
  try {
    if (fs.existsSync(legacyPath)) {
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(legacyPath, destPath);
    }
  } catch (error) {
    /* ignore migration failures */
  }
};

const readAgentDetails = (userIdRaw) => {
  const filePath = resolveAgentDetailsPath(userIdRaw);
  const safeUserId = sanitizeAgentDetailsUserId(String(userIdRaw || ""));
  const hasPerUserId = Boolean(safeUserId);

  if (hasPerUserId) {
    migrateLegacyPerUserAgentDetails(safeUserId, filePath);
  }

  if (hasPerUserId && !fs.existsSync(filePath)) {
    return getDefaultAgentDetails();
  }
  if (!hasPerUserId) {
    ensureAgentDetailsFile();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      ...getDefaultAgentDetails(),
      ...parsed,
      productsOrServices: sanitizeProductsOrServices(parsed.productsOrServices),
      fieldsToCollectEnabled: Boolean(parsed.fieldsToCollectEnabled),
      fieldsToCollect: sanitizeFieldsToCollect(parsed.fieldsToCollect),
    };
  } catch (error) {
    return getDefaultAgentDetails();
  }
};

const writeAgentDetails = (details, userIdRaw) => {
  const filePath = resolveAgentDetailsPath(userIdRaw);
  if (!sanitizeAgentDetailsUserId(String(userIdRaw || ""))) {
    ensureAgentDetailsFile();
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(details, null, 2), "utf8");
};

const getFieldsToCollectList = (details) => {
  if (!details || !details.fieldsToCollectEnabled || !Array.isArray(details.fieldsToCollect)) return [];
  return details.fieldsToCollect.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean);
};

const buildTestBotSystemPrompt = (details) => {
  const basic = typeof details.basicDetails === "string" ? details.basicDetails.trim() : "";
  const company = typeof details.companyDetails === "string" ? details.companyDetails.trim() : "";
  const contactEmail = typeof details.contactEmail === "string" ? details.contactEmail.trim() : "";
  const contactPhone = typeof details.contactPhone === "string" ? details.contactPhone.trim() : "";
  const contactWebsite = typeof details.contactWebsite === "string" ? details.contactWebsite.trim() : "";
  const contactAddress = typeof details.contactAddress === "string" ? details.contactAddress.trim() : "";
  const targets = typeof details.agentTargets === "string" ? details.agentTargets.trim() : "";
  const other = typeof details.otherDetails === "string" ? details.otherDetails.trim() : "";

  const products = Array.isArray(details.productsOrServices) ? details.productsOrServices : [];
  const productLines = [];
  products.forEach((item) => {
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const desc = typeof item?.description === "string" ? item.description.trim() : "";
    const pdfName =
      item?.attachmentKind === "pdf" && typeof item?.pdf?.pdfName === "string"
        ? item.pdf.pdfName.trim()
        : "";
    if (!title && !desc && !pdfName) return;
    let line = "";
    if (title && desc) line = `${title}: ${desc}`;
    else if (title) line = title;
    else if (desc) line = desc;
    else line = "";
    if (pdfName) {
      line = line ? `${line} [PDF on file: ${pdfName}]` : `[PDF on file: ${pdfName}]`;
    }
    productLines.push(`- ${line}`);
  });

  const fields = getFieldsToCollectList(details);

  const knowledgeParts = [];
  if (basic) knowledgeParts.push(`## Agent role and behaviour\n${basic}`);
  if (company) knowledgeParts.push(`## Company / institute\n${company}`);
  const contactLines = [];
  if (contactEmail) contactLines.push(`Email: ${contactEmail}`);
  if (contactPhone) contactLines.push(`Phone: ${contactPhone}`);
  if (contactWebsite) contactLines.push(`Website: ${contactWebsite}`);
  if (contactAddress) contactLines.push(`Address:\n${contactAddress}`);
  if (contactLines.length) {
    knowledgeParts.push(`## Contact details\n${contactLines.join("\n")}`);
  }
  if (productLines.length) {
    knowledgeParts.push(
      `## Products or services\n${productLines.join("\n")}\n\n` +
        `Answer from the facts above in a short or medium-length reply—never long essays unless the user explicitly asks for a long explanation. ` +
        `Never ask the visitor to upload or send their own photos, screenshots, PDFs, or documents. ` +
        `The owner may attach official images or a PDF to items in this list. Only mention that photos or a PDF appear below your message when the visitor is asking for deeper detail or for visuals/documents about a product or service (the chat may attach them in that case). On brief or general questions, do not say that files are attached below.`
    );
  }
  if (targets) knowledgeParts.push(`## Goals / targets\n${targets}`);
  if (fields.length) {
    knowledgeParts.push(
      `## Fields to collect (workspace configuration)\n` +
        `Labels: ${fields.join(", ")}.\n` +
        `Over the chat, gather each value when it feels natural—never as a rigid form. Do not re-ask for something the user already gave. ` +
        `Ask for only ONE field per assistant message. Never request multiple fields in one sentence.\n` +
        `If labels include name/email/phone (or similar), ask them in separate turns: first one field, wait for user answer, then ask the next missing field.\n` +
        `When a separate "AI-generated next collection prompt" section appears below, treat it as the suggested wording for the next missing field; fold it into your reply only if it fits the moment (you may rephrase slightly).`
    );
  }
  if (other) knowledgeParts.push(`## Additional notes\n${other}`);

  const brevity =
    "Keep replies short or medium length: typically about two to six sentences, or a small bullet list—concise and easy to scan. Avoid long paragraphs, rambling, and lists of more than about six bullets unless the user explicitly asks for a comprehensive or very detailed answer.";

  const languageMirroring =
    "Language: From the user's latest message in this conversation, infer which natural language they are using and respond entirely in that same language (same script when applicable). If that message mixes languages, prefer the dominant one. Apply this to every part of your reply, including follow-up questions and field-collection prompts.";

  if (!knowledgeParts.length) {
    return (
      "You are a test chatbot for this workspace. The owner has not saved any Knowledgebase text yet, so you have no organization-specific facts. " +
      "Reply briefly and helpfully in general terms. If the user asks for policies, programs, or contact details tied to their business, explain that nothing was configured yet and they can add it under Knowledgebase. " +
      brevity +
      " " +
      languageMirroring
    );
  }

  const hasContactPhoneOrEmail = Boolean(contactPhone) || Boolean(contactEmail);
  const outOfScopeReply =
    "When the user's question cannot be answered from the facts in the sections below (the topic is not covered by Knowledgebase): " +
    "Do **not** lead with vague refusals like “I don't know”, “I'm not sure”, or “that wasn't provided in your profile.” " +
    "Instead, briefly acknowledge that this specific detail is not in your configured facts, then tell them that **for more complete or authoritative information they should contact the relevant person or team** at the organization. " +
    (hasContactPhoneOrEmail
      ? "**In the same reply**, share the organization's **phone number and email** using **only** the exact values from the `## Contact details` section below (include both when both are listed there). Never invent or alter digits or addresses. "
      : "If `## Contact details` below does not include a phone or email, do not invent any—point them to whatever contact channels are actually listed there (e.g. website or address), or to the organization's official channels. ") +
    (fields.length > 0
      ? "After that contact guidance, **in the same assistant message**, continue with **one** short question to collect the next missing lead field, following the `## Fields to collect` rules below and any `## AI-generated next collection prompt` appended to this prompt. Ask only one field per reply. "
      : "Do not ask for lead or profile fields when answering an out-of-scope question unless a `## Fields to collect` section appears in the sections below (workspace toggle enabled). ");

  const preamble =
    "You are this workspace's test chatbot. Only use the facts in the sections below—they are exactly what the user entered in Knowledgebase, nothing else. " +
    "Do not invent prices, dates, policies, products, or contact details. " +
    outOfScopeReply +
    "The first assistant message in this thread may already be the user's configured greeting (who you are and which organization). Do not repeat that introduction or another “Hi, I'm an AI agent of…” opener—answer the user's latest message directly in short form. Only re-introduce yourself if they explicitly ask who you are again. " +
    brevity +
    " " +
    languageMirroring;

  return [preamble, ...knowledgeParts].join("\n\n");
};

const sanitizeChatMessages = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const role = entry?.role === "assistant" ? "assistant" : entry?.role === "user" ? "user" : null;
    const content = typeof entry?.content === "string" ? entry.content.trim() : "";
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, 16000) });
  }
  return out.slice(-30);
};

/**
 * Second OpenAI call: from transcript + field labels, produce one short question
 * for the next missing field, or empty string if planner says SKIP / on failure.
 */
const generateFieldCollectionPrompt = async (fieldLabels, chatMessages) => {
  if (!fieldLabels.length) return "";
  const apiKey = readEnvCredential("OPENAI_API_KEY");
  if (!apiKey) return "";

  const transcript = chatMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(-8000);

  const plannerSystem =
    "You write the next single question a support bot should ask to collect profile details. " +
    "Output plain text only: one short question (max 28 words), no quotes. " +
    "Ask for exactly ONE missing field per question. Never combine name, email, and phone in one question. " +
    "If every listed field is already clearly present in the transcript, or it would be rude or off-topic to ask now, output exactly: SKIP";

  const plannerUser =
    `Field labels to collect (not all at once): ${fieldLabels.join(" | ")}

Chat transcript:
${transcript}

One question for the highest-priority missing field, or SKIP.`;

  try {
    const model = readEnvCredential("OPENAI_MODEL") || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: plannerSystem },
          { role: "user", content: plannerUser },
        ],
        temperature: 0.35,
        max_tokens: 100,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return "";
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return "";
    const t = text.trim().replace(/^["']+|["']+$/g, "");
    if (!t || /^skip\b/i.test(t)) return "";
    return t.slice(0, 320);
  } catch (error) {
    return "";
  }
};

const callOpenAIChat = async (systemPrompt, chatMessages) => {
  const apiKey = readEnvCredential("OPENAI_API_KEY");
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set");
    err.code = "NO_OPENAI_KEY";
    throw err;
  }
  const model = readEnvCredential("OPENAI_MODEL") || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt.slice(0, 32000) }, ...chatMessages],
      temperature: 0.5,
      max_tokens: 320,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error?.message === "string" ? data.error.message : `OpenAI error (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Empty response from OpenAI");
  }
  return text.trim();
};

/**
 * Shared chat completion for HTTP `/chat/test` and WhatsApp inbound messages.
 * @returns {Promise<object>} result object with `kind` discriminator
 */
const completeWorkspaceChatTurn = async (parsedBody) => {
  const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
  const conversationId =
    typeof parsedBody.conversationId === "string" ? parsedBody.conversationId : "";
  const sessionChannelOpts = {
    chatSource: parsedBody.chatSource,
    channelAccountName: parsedBody.channelAccountName,
    whatsappChatId: parsedBody.whatsappChatId,
  };

  let cleaned = [];

  try {
    const details = readAgentDetails(userId);
    const widgetSettings = readWidgetSettings(userId);
    const aiRepliesEnabled = widgetSettings.aiRepliesEnabled !== false;

    cleaned = sanitizeChatMessages(parsedBody.messages);
    if (!cleaned.length) {
      return { kind: "validation_error", status: 400, message: "messages must be a non-empty array of { role: user|assistant, content }" };
    }
    if (cleaned[cleaned.length - 1].role !== "user") {
      return { kind: "validation_error", status: 400, message: "The last message must be from the user" };
    }

    const fieldLabels = getFieldsToCollectList(details);
    let lead = getLeadByConversation(userId, conversationId);
    if (fieldLabels.length > 0) {
      let extracted;
      if (aiRepliesEnabled) {
        const apiKeyExtract = readEnvCredential("OPENAI_API_KEY");
        if (apiKeyExtract) {
          extracted = await extractCollectedFieldsWithOpenAI(
            fieldLabels,
            cleaned,
            lead?.collectedData || {}
          );
        } else {
          extracted = extractCollectedFieldsHeuristic(
            fieldLabels,
            cleaned,
            lead?.collectedData || {}
          );
        }
      } else {
        extracted = extractCollectedFieldsHeuristic(
          fieldLabels,
          cleaned,
          lead?.collectedData || {}
        );
      }
      lead = upsertLeadByConversation(userId, conversationId, fieldLabels, extracted) || lead;
    }

    const existingSession = getTestChatSessionByConversation(userId, conversationId);
    const liveAgentEnabled = Boolean(existingSession?.liveAgentEnabled);
    if (liveAgentEnabled) {
      saveTestChatSession(userId, conversationId, cleaned, {
        liveAgentEnabled: true,
        ...sessionChannelOpts,
      });
      return {
        kind: "live_agent",
        collectedData: lead?.collectedData || {},
      };
    }

    if (!aiRepliesEnabled) {
      saveTestChatSession(userId, conversationId, cleaned, {
        liveAgentEnabled: false,
        ...sessionChannelOpts,
      });
      return {
        kind: "ai_disabled",
        collectedData: lead?.collectedData || {},
      };
    }

    const apiKey = readEnvCredential("OPENAI_API_KEY");
    if (!apiKey) {
      saveTestChatSession(userId, conversationId, cleaned, {
        liveAgentEnabled: false,
        ...sessionChannelOpts,
      });
      return { kind: "openai_missing", message: "OpenAI is not configured on this server." };
    }

    let systemPrompt = buildTestBotSystemPrompt(details);
    if (fieldLabels.length > 0) {
      const collectionCue = await generateFieldCollectionPrompt(fieldLabels, cleaned);
      if (collectionCue) {
        systemPrompt += `\n\n## AI-generated next collection prompt\n${collectionCue}`;
      }
    }

    const reply = await callOpenAIChat(systemPrompt, cleaned);
    const lastUserText = cleaned[cleaned.length - 1]?.content || "";
    const attachments = collectWorkspaceProductAttachments(
      details.productsOrServices,
      lastUserText,
      reply
    );
    const assistantRecord = { role: "assistant", content: reply };
    if (attachments.length) assistantRecord.attachments = attachments;
    saveTestChatSession(userId, conversationId, [...cleaned, assistantRecord], {
      liveAgentEnabled: false,
      ...sessionChannelOpts,
    });
    return {
      kind: "success",
      reply,
      attachments,
      collectedData: lead?.collectedData || {},
    };
  } catch (err) {
    if (cleaned.length) {
      try {
        saveTestChatSession(userId, conversationId, cleaned, {
          liveAgentEnabled: false,
          ...sessionChannelOpts,
        });
      } catch {
        /* ignore secondary persistence errors */
      }
    }
    const status =
      err && typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 502;
    const message = err instanceof Error ? err.message : "Chat request failed";
    return {
      kind: "error",
      status: status >= 400 && status < 600 ? status : 502,
      message,
    };
  }
};

const whatsappBridge = createWhatsAppBridge({
  completeWorkspaceChatTurn,
  sanitizeAgentDetailsUserId,
  getTestChatSessionByConversation,
  sanitizeChatMessages,
});

const readMetrics = () => {
  const defaults = {
    aiAgentsLive: 0,
    aiAgentsDrafts: 0,
    accessRules: 0,
    accessRulesHint: "Synced",
    activeSessions: 0,
    activeSessionsHint: "Last hour",
  };
  try {
    if (!fs.existsSync(METRICS_PATH)) {
      return defaults;
    }
    const raw = fs.readFileSync(METRICS_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      ...defaults,
      ...parsed,
    };
  } catch (error) {
    return defaults;
  }
};

const parseJsonBody = (req, onSuccess, onError) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    try {
      onSuccess(JSON.parse(body || "{}"));
    } catch (error) {
      onError();
    }
  });
};

const pathname = (req) => {
  const raw = req.url || "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
};

const parseQuery = (req) => {
  const raw = req.url || "/";
  const q = raw.indexOf("?");
  if (q === -1) return {};
  const params = new URLSearchParams(raw.slice(q + 1));
  const out = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
};

const getAccountIdFromPath = (reqPath) => {
  const prefix = "/admin/accounts/";
  if (!reqPath.startsWith(prefix)) return "";
  return decodeURIComponent(reqPath.slice(prefix.length)).trim();
};

const normalizePlan = (plan) => {
  if (typeof plan !== "string") return "";
  const cleaned = plan.trim().toLowerCase();
  if (cleaned === "test") return "Test";
  if (cleaned === "trial") return "Trial";
  if (cleaned === "basic") return "Basic";
  if (cleaned === "pro") return "Pro";
  return "";
};

const evaluatePlanAccess = (account) => {
  const normalizedPlan = normalizePlan(account.plan);
  if (!normalizedPlan) {
    return {
      ok: false,
      statusCode: 403,
      message: "This account has an invalid plan. Contact admin.",
      chatbotEnabled: false,
      normalizedPlan: account.plan,
      expiresAt: null,
    };
  }

  if (normalizedPlan === "Basic" || normalizedPlan === "Pro") {
    return {
      ok: true,
      chatbotEnabled: true,
      normalizedPlan,
      expiresAt: null,
      message: "",
    };
  }

  const createdAtMs = Date.parse(String(account.createdAt || ""));
  if (!Number.isFinite(createdAtMs)) {
    return {
      ok: false,
      statusCode: 403,
      message: "Trial account has invalid start date. Contact admin.",
      chatbotEnabled: false,
      normalizedPlan,
      expiresAt: null,
    };
  }

  const days = PLAN_TRIAL_DAYS[normalizedPlan];
  const expiresAtMs = createdAtMs + days * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now > expiresAtMs) {
    return {
      ok: false,
      statusCode: 403,
      message: `${normalizedPlan} plan expired. Contact admin to upgrade.`,
      chatbotEnabled: false,
      normalizedPlan,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  return {
    ok: true,
    chatbotEnabled: false,
    normalizedPlan,
    expiresAt: new Date(expiresAtMs).toISOString(),
    message: "",
  };
};

const server = http.createServer((req, res) => {
  const reqPath = pathname(req);

  if (
    (
      reqPath === "/login" ||
      reqPath === "/admin/login" ||
      reqPath === "/admin/accounts" ||
      reqPath === "/admin/metrics" ||
      reqPath === "/agent-details" ||
      reqPath === "/widget-settings" ||
      reqPath === "/leads" ||
      reqPath === "/chat/test" ||
      reqPath === "/chat/test/live-agent" ||
      reqPath === "/chat/test/live-message" ||
      reqPath === "/chat/test/session" ||
      reqPath === "/chat/test/sessions" ||
      reqPath.startsWith("/admin/accounts/") ||
      reqPath.startsWith("/integrations/whatsapp")
    ) &&
    req.method === "OPTIONS"
  ) {
    res.writeHead(204, adminCorsHeaders);
    res.end();
    return;
  }

  if (req.method === "POST" && reqPath === "/admin/login") {
    if (!adminAuthConfigured()) {
      return sendJson(
        res,
        503,
        { message: "Admin login is not configured on the server" },
        adminCorsHeaders
      );
    }

    parseJsonBody(
      req,
      (parsedBody) => {
      const username =
        typeof parsedBody.username === "string" ? parsedBody.username.trim() : "";
      const password =
        typeof parsedBody.password === "string" ? parsedBody.password : "";

      if (!username || !password) {
        return sendJson(
          res,
          400,
          { message: "Username and password are required" },
          adminCorsHeaders
        );
      }

      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return sendJson(
          res,
          200,
          { message: "Login successful" },
          adminCorsHeaders
        );
      }

      return sendJson(res, 401, { message: "Invalid credentials" }, adminCorsHeaders);
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/login") {
    parseJsonBody(
      req,
      (parsedBody) => {
        const identity =
          typeof parsedBody.username === "string" ? parsedBody.username.trim().toLowerCase() : "";
        const password = typeof parsedBody.password === "string" ? parsedBody.password : "";

        if (!identity || !password) {
          return sendJson(
            res,
            400,
            { message: "Username/email and password are required" },
            adminCorsHeaders
          );
        }

        const accounts = readAccounts();
        const account = accounts.find((entry) => {
          const byEmail = String(entry.email || "").toLowerCase() === identity;
          const byUsername = String(entry.username || "").toLowerCase() === identity;
          return (byEmail || byUsername) && String(entry.password || "") === password;
        });

        if (!account) {
          return sendJson(res, 401, { message: "Invalid credentials" }, adminCorsHeaders);
        }

        if (String(account.status || "").toLowerCase() !== "active") {
          return sendJson(
            res,
            403,
            { message: "This account is inactive. Contact admin." },
            adminCorsHeaders
          );
        }

        const planAccess = evaluatePlanAccess(account);
        if (!planAccess.ok) {
          return sendJson(
            res,
            planAccess.statusCode || 403,
            {
              message: planAccess.message,
              plan: planAccess.normalizedPlan,
              chatbotEnabled: false,
              expiresAt: planAccess.expiresAt,
            },
            adminCorsHeaders
          );
        }

        return sendJson(
          res,
          200,
          {
            message: "Login successful",
            user: {
              id: account.id,
              username: account.username,
              email: account.email,
              plan: planAccess.normalizedPlan,
              status: account.status,
              chatbotEnabled: planAccess.chatbotEnabled,
              expiresAt: planAccess.expiresAt,
            },
          },
          adminCorsHeaders
        );
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "GET" && reqPath === "/admin/accounts") {
    const accounts = readAccounts();
    return sendJson(res, 200, { accounts }, adminCorsHeaders);
  }

  if (req.method === "GET" && reqPath === "/admin/metrics") {
    const accounts = readAccounts();
    const metrics = readMetrics();
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const usersAddedThisWeek = accounts.filter((entry) => {
      const created = Date.parse(entry.createdAt || "");
      return Number.isFinite(created) && now - created <= oneWeekMs;
    }).length;
    return sendJson(
      res,
      200,
      {
        workspaceUsers: accounts.length,
        usersAddedThisWeek,
        aiAgentsLive: Number(metrics.aiAgentsLive) || 0,
        aiAgentsDrafts: Number(metrics.aiAgentsDrafts) || 0,
        accessRules: Number(metrics.accessRules) || 0,
        accessRulesHint: String(metrics.accessRulesHint || "Synced"),
        activeSessions: Number(metrics.activeSessions) || 0,
        activeSessionsHint: String(metrics.activeSessionsHint || "Last hour"),
      },
      adminCorsHeaders
    );
  }

  if (req.method === "GET" && reqPath === "/agent-details") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const details = readAgentDetails(userId);
    return sendJson(res, 200, { details }, adminCorsHeaders);
  }

  if (req.method === "GET" && reqPath === "/widget-settings") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const settings = readWidgetSettings(userId);
    return sendJson(res, 200, { settings }, adminCorsHeaders);
  }

  if (req.method === "GET" && reqPath === "/leads") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const leads = getLeadsForUser(userId);
    return sendJson(res, 200, { leads }, adminCorsHeaders);
  }

  if (req.method === "POST" && reqPath === "/widget-settings") {
    parseJsonBody(
      req,
      (parsedBody) => {
        const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
        const saved = writeWidgetSettings(userId, parsedBody);
        if (!saved) {
          return sendJson(res, 400, { message: "A valid userId is required" }, adminCorsHeaders);
        }
        return sendJson(res, 200, { message: "Widget settings saved", settings: saved }, adminCorsHeaders);
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/agent-details") {
    parseJsonBody(
      req,
      (parsedBody) => {
        const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
        const safeUserId = sanitizeAgentDetailsUserId(userId);
        const details = {
          basicDetails:
            typeof parsedBody.basicDetails === "string" ? parsedBody.basicDetails.trim() : "",
          companyDetails:
            typeof parsedBody.companyDetails === "string" ? parsedBody.companyDetails.trim() : "",
          contactEmail: clampAgentDetailString(parsedBody.contactEmail, 320),
          contactPhone: clampAgentDetailString(parsedBody.contactPhone, 80),
          contactWebsite: clampAgentDetailString(parsedBody.contactWebsite, 500),
          contactAddress: clampAgentDetailString(parsedBody.contactAddress, 2000),
          productsOrServices: sanitizeProductsOrServices(parsedBody.productsOrServices),
          agentTargets:
            typeof parsedBody.agentTargets === "string" ? parsedBody.agentTargets.trim() : "",
          fieldsToCollectEnabled: Boolean(parsedBody.fieldsToCollectEnabled),
          fieldsToCollect: Boolean(parsedBody.fieldsToCollectEnabled)
            ? sanitizeFieldsToCollect(parsedBody.fieldsToCollect)
            : [],
          otherDetails:
            typeof parsedBody.otherDetails === "string" ? parsedBody.otherDetails.trim() : "",
          updatedAt: new Date().toISOString(),
        };
        if (safeUserId) {
          details.workspaceUserId = safeUserId;
        }
        writeAgentDetails(details, userId);
        return sendJson(res, 200, { message: "Agent details saved", details }, adminCorsHeaders);
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/chat/test") {
    parseJsonBody(
      req,
      (parsedBody) => {
        void (async () => {
          const result = await completeWorkspaceChatTurn(parsedBody);
          if (result.kind === "validation_error") {
            return sendJson(res, result.status, { message: result.message }, adminCorsHeaders);
          }
          if (result.kind === "live_agent") {
            return sendJson(
              res,
              200,
              {
                reply: "",
                liveAgentEnabled: true,
                message: "Live Agent mode is enabled for this conversation.",
                collectedData: result.collectedData,
              },
              adminCorsHeaders
            );
          }
          if (result.kind === "ai_disabled") {
            return sendJson(
              res,
              200,
              {
                reply: "",
                aiRepliesDisabled: true,
                collectedData: result.collectedData,
              },
              adminCorsHeaders
            );
          }
          if (result.kind === "openai_missing") {
            return sendJson(res, 503, { message: result.message }, adminCorsHeaders);
          }
          if (result.kind === "error") {
            return sendJson(res, result.status, { message: result.message }, adminCorsHeaders);
          }
          if (result.kind === "success") {
            return sendJson(
              res,
              200,
              {
                reply: result.reply,
                attachments: Array.isArray(result.attachments) ? result.attachments : [],
                collectedData: result.collectedData,
              },
              adminCorsHeaders
            );
          }
          return sendJson(res, 500, { message: "Unexpected chat result" }, adminCorsHeaders);
        })();
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "GET" && reqPath === "/chat/test/sessions") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const sessions = getTestChatSessionsForUser(userId);
    return sendJson(res, 200, { sessions }, adminCorsHeaders);
  }

  if (req.method === "GET" && reqPath === "/chat/test/session") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const conversationId =
      typeof query.conversationId === "string" ? query.conversationId : "";
    const session = getTestChatSessionByConversation(userId, conversationId);
    const lead = getLeadByConversation(userId, conversationId);
    return sendJson(res, 200, { session, lead }, adminCorsHeaders);
  }

  if (req.method === "POST" && reqPath === "/chat/test/live-agent") {
    parseJsonBody(
      req,
      (parsedBody) => {
        const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
        const conversationId =
          typeof parsedBody.conversationId === "string" ? parsedBody.conversationId : "";
        const enabled = Boolean(parsedBody.enabled);
        const session = updateLiveAgentMode(userId, conversationId, enabled);
        if (!session) {
          return sendJson(
            res,
            404,
            { message: "Conversation not found for this user/conversationId" },
            adminCorsHeaders
          );
        }
        return sendJson(res, 200, { session }, adminCorsHeaders);
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/chat/test/live-message") {
    parseJsonBody(
      req,
      (parsedBody) => {
        void (async () => {
          const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
          const conversationId =
            typeof parsedBody.conversationId === "string" ? parsedBody.conversationId : "";
          const message = typeof parsedBody.message === "string" ? parsedBody.message : "";
          const session = appendLiveAgentMessage(userId, conversationId, message);
          if (!session) {
            return sendJson(
              res,
              404,
              { message: "Conversation not found, live mode disabled, or message empty" },
              adminCorsHeaders
            );
          }
          const waPeer =
            typeof session.whatsappChatId === "string" ? session.whatsappChatId.trim() : "";
          if (sanitizeChatSource(session.chatSource) === "whatsapp" && waPeer) {
            await whatsappBridge.sendText(userId, waPeer, message);
          }
          return sendJson(res, 200, { session }, adminCorsHeaders);
        })();
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "GET" && reqPath === "/integrations/whatsapp/status") {
    const query = parseQuery(req);
    const userId = typeof query.userId === "string" ? query.userId : "";
    const status = whatsappBridge.getStatus(userId);
    return sendJson(res, 200, status, adminCorsHeaders);
  }

  if (req.method === "POST" && reqPath === "/integrations/whatsapp/start") {
    parseJsonBody(
      req,
      (parsedBody) => {
        void (async () => {
          try {
            const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
            if (!sanitizeAgentDetailsUserId(userId)) {
              return sendJson(res, 400, { message: "Valid userId is required" }, adminCorsHeaders);
            }
            await whatsappBridge.startLinking(userId);
            return sendJson(
              res,
              200,
              { message: "WhatsApp client started", ...whatsappBridge.getStatus(userId) },
              adminCorsHeaders
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return sendJson(res, 500, { message: msg }, adminCorsHeaders);
          }
        })();
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/integrations/whatsapp/disconnect") {
    parseJsonBody(
      req,
      (parsedBody) => {
        void (async () => {
          const userId = typeof parsedBody.userId === "string" ? parsedBody.userId : "";
          await whatsappBridge.destroyClient(userId);
          whatsappAutoStart.removeUserId(userId);
          return sendJson(
            res,
            200,
            { message: "Disconnected", ...whatsappBridge.getStatus(userId) },
            adminCorsHeaders
          );
        })();
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );
    return;
  }

  if (req.method === "POST" && reqPath === "/admin/accounts") {
    parseJsonBody(
      req,
      (parsedBody) => {
        const username =
          typeof parsedBody.username === "string" ? parsedBody.username.trim() : "";
        const email = typeof parsedBody.email === "string" ? parsedBody.email.trim().toLowerCase() : "";
        const password = typeof parsedBody.password === "string" ? parsedBody.password : "";
        const contactNumber =
          typeof parsedBody.contactNumber === "string" ? parsedBody.contactNumber.trim() : "";
        const plan = normalizePlan(parsedBody.plan);
        const status = typeof parsedBody.status === "string" ? parsedBody.status.trim() : "";

        if (!username || !email || !password || !contactNumber || !plan || !status) {
          return sendJson(
            res,
            400,
            { message: "username, email, password, contactNumber, plan, and status are required" },
            adminCorsHeaders
          );
        }
        if (!email.includes("@") || !email.includes(".")) {
          return sendJson(res, 400, { message: "Invalid email format" }, adminCorsHeaders);
        }
        if (!ALLOWED_PLANS.has(plan)) {
          return sendJson(res, 400, { message: "Invalid plan value" }, adminCorsHeaders);
        }
        if (!ALLOWED_STATUS.has(status)) {
          return sendJson(res, 400, { message: "Invalid status value" }, adminCorsHeaders);
        }

        const accounts = readAccounts();
        if (accounts.some((entry) => String(entry.email || "").toLowerCase() === email)) {
          return sendJson(res, 409, { message: "Email already exists" }, adminCorsHeaders);
        }
        if (accounts.some((entry) => String(entry.username || "").toLowerCase() === username.toLowerCase())) {
          return sendJson(res, 409, { message: "Username already exists" }, adminCorsHeaders);
        }

        const account = {
          id: `${Date.now()}`,
          username,
          email,
          password,
          contactNumber,
          plan,
          status,
          createdAt: new Date().toISOString(),
        };
        const updated = [account, ...accounts];
        writeAccounts(updated);
        return sendJson(res, 201, { account, accounts: updated }, adminCorsHeaders);
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );

    return;
  }

  if (req.method === "PUT" && reqPath.startsWith("/admin/accounts/")) {
    const targetId = getAccountIdFromPath(reqPath);
    if (!targetId) {
      return sendJson(res, 400, { message: "Account id is required" }, adminCorsHeaders);
    }

    parseJsonBody(
      req,
      (parsedBody) => {
        const username =
          typeof parsedBody.username === "string" ? parsedBody.username.trim() : "";
        const email =
          typeof parsedBody.email === "string" ? parsedBody.email.trim().toLowerCase() : "";
        const password = typeof parsedBody.password === "string" ? parsedBody.password : "";
        const contactNumber =
          typeof parsedBody.contactNumber === "string" ? parsedBody.contactNumber.trim() : "";
        const plan = normalizePlan(parsedBody.plan);
        const status = typeof parsedBody.status === "string" ? parsedBody.status.trim() : "";

        if (!username || !email || !password || !contactNumber || !plan || !status) {
          return sendJson(
            res,
            400,
            { message: "username, email, password, contactNumber, plan, and status are required" },
            adminCorsHeaders
          );
        }
        if (!email.includes("@") || !email.includes(".")) {
          return sendJson(res, 400, { message: "Invalid email format" }, adminCorsHeaders);
        }
        if (!ALLOWED_PLANS.has(plan)) {
          return sendJson(res, 400, { message: "Invalid plan value" }, adminCorsHeaders);
        }
        if (!ALLOWED_STATUS.has(status)) {
          return sendJson(res, 400, { message: "Invalid status value" }, adminCorsHeaders);
        }

        const accounts = readAccounts();
        const idx = accounts.findIndex((entry) => String(entry.id) === targetId);
        if (idx === -1) {
          return sendJson(res, 404, { message: "Account not found" }, adminCorsHeaders);
        }
        const duplicateEmail = accounts.some(
          (entry, i) => i !== idx && String(entry.email || "").toLowerCase() === email
        );
        if (duplicateEmail) {
          return sendJson(res, 409, { message: "Email already exists" }, adminCorsHeaders);
        }
        const duplicateUsername = accounts.some(
          (entry, i) => i !== idx && String(entry.username || "").toLowerCase() === username.toLowerCase()
        );
        if (duplicateUsername) {
          return sendJson(res, 409, { message: "Username already exists" }, adminCorsHeaders);
        }

        const previous = accounts[idx];
        const updatedAccount = {
          ...previous,
          username,
          email,
          password,
          contactNumber,
          plan,
          status,
          updatedAt: new Date().toISOString(),
        };
        const updatedAccounts = [...accounts];
        updatedAccounts[idx] = updatedAccount;
        writeAccounts(updatedAccounts);
        return sendJson(
          res,
          200,
          { account: updatedAccount, accounts: updatedAccounts },
          adminCorsHeaders
        );
      },
      () => sendJson(res, 400, { message: "Invalid JSON body" }, adminCorsHeaders)
    );

    return;
  }

  if (req.method === "GET" && tryServeFrontendBuild(reqPath, res)) {
    return;
  }

  if (res.headersSent || res.writableEnded) return;
  sendJson(res, 200, {
    message: "Server is running",
    method: req.method,
    url: req.url,
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  const restartIds = whatsappAutoStart.readRestoreUserIds();
  if (restartIds.length === 0) return;
  console.log(
    `[whatsapp] auto-connect: initializing ${restartIds.length} WhatsApp client(s) (saved sessions + disk)…`
  );
  void (async () => {
    for (const uid of restartIds) {
      if (!sanitizeAgentDetailsUserId(uid)) continue;
      try {
        await whatsappBridge.startLinking(uid);
      } catch (e) {
        console.warn(
          "[whatsapp] auto-connect failed:",
          uid,
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  })();
});
