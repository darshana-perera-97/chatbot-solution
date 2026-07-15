const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const QRCode = require("qrcode");
const whatsappAutoStart = require("./whatsappAutoStart");
const { sanitizeWhatsAppAccountId } = require("./planConfig");

let Client;
let LocalAuth;
try {
  ({ Client, LocalAuth } = require("whatsapp-web.js"));
} catch {
  Client = null;
  LocalAuth = null;
}

const dataRoot = path.join(__dirname, "data");

function resolveUserAuthRoot(workspaceUserId) {
  const safeUserId = String(workspaceUserId || "").trim();
  const userDir = path.join(dataRoot, safeUserId);
  const authRoot = path.join(userDir, "whatsapp-auth");
  if (!fs.existsSync(authRoot)) {
    fs.mkdirSync(authRoot, { recursive: true });
  }
  return authRoot;
}

function localAuthClientIdForAccount(accountId) {
  const safe = sanitizeWhatsAppAccountId(accountId) || "1";
  return safe === "1" ? "wa" : `wa-${safe}`;
}

function slotKey(workspaceUserId, accountId) {
  const safeUserId = String(workspaceUserId || "").trim();
  const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
  return `${safeUserId}::${safeAccountId}`;
}

function resolveUserWebCacheDir(workspaceUserId, accountId = "1") {
  const safeUserId = String(workspaceUserId || "").trim();
  const userDir = path.join(dataRoot, safeUserId);
  const clientId = localAuthClientIdForAccount(accountId);
  const cacheDir =
    clientId === "wa"
      ? path.join(userDir, ".wwebjs_cache")
      : path.join(userDir, `.wwebjs_cache-${clientId}`);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

function resolveAccountSessionDir(workspaceUserId, accountId = "1") {
  const safeUserId = String(workspaceUserId || "").trim();
  const clientId = localAuthClientIdForAccount(accountId);
  return path.join(dataRoot, safeUserId, "whatsapp-auth", `session-${clientId}`);
}

function hasPersistedAccountSession(workspaceUserId, accountId = "1") {
  return fs.existsSync(resolveAccountSessionDir(workspaceUserId, accountId));
}

const ELF_MACHINE = {
  x64: 62, // EM_X86_64
  arm64: 183, // EM_AARCH64
  arm: 40, // EM_ARM
  ia32: 3, // EM_386
};

function expectedElfMachineForHost() {
  const arch = os.arch();
  if (arch === "x64" || arch === "amd64") return ELF_MACHINE.x64;
  if (arch === "arm64" || arch === "aarch64") return ELF_MACHINE.arm64;
  if (arch === "arm") return ELF_MACHINE.arm;
  if (arch === "ia32" || arch === "x86") return ELF_MACHINE.ia32;
  return null;
}

function readElfMachineType(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(20);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead < 20) return null;
    if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
      return null;
    }
    return header.readUInt16LE(18);
  } finally {
    fs.closeSync(fd);
  }
}

function resolveBinaryPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function isSnapBrowserPath(filePath) {
  const resolved = resolveBinaryPath(filePath).replace(/\\/g, "/");
  if (resolved.includes("/snap/")) return true;

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    const head = fs.readFileSync(filePath, "utf8").slice(0, 1024);
    if (/snap\.chromium\.chromium|\/snap\/bin\/chromium/i.test(head)) return true;
  } catch {
    /* ignore read errors */
  }

  return false;
}

function isCompatibleChromeExecutable(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
  } catch {
    return false;
  }

  if (process.platform === "linux" && isSnapBrowserPath(filePath)) {
    console.warn(
      `[whatsapp] skipping snap Chromium (incompatible with PM2/systemd): ${filePath}`
    );
    return false;
  }

  if (process.platform !== "linux") return true;

  const expectedMachine = expectedElfMachineForHost();
  if (expectedMachine == null) return true;

  const actualMachine = readElfMachineType(filePath);
  if (actualMachine == null) {
    // Some distros ship a small shell wrapper; allow it and let Chromium start.
    return true;
  }

  if (actualMachine !== expectedMachine) {
    console.warn(
      `[whatsapp] skipping browser binary (wrong CPU architecture): ${filePath} ` +
        `(host=${os.arch()}, elf=${actualMachine}, expected=${expectedMachine})`
    );
    return false;
  }

  // Puppeteer occasionally caches linux_arm with an x64 chrome folder.
  const normalized = filePath.replace(/\\/g, "/");
  if (
    (os.arch() === "arm64" || os.arch() === "aarch64") &&
    normalized.includes("/.cache/puppeteer/") &&
    normalized.includes("linux_arm") &&
    normalized.includes("chrome-linux64")
  ) {
    console.warn(
      `[whatsapp] skipping mismatched Puppeteer Chrome cache for ARM Linux: ${filePath}`
    );
    return false;
  }

  return true;
}

function pickChromeExecutable(candidates) {
  for (const candidate of candidates) {
    if (isCompatibleChromeExecutable(candidate)) return candidate;
  }
  return "";
}

function resolveChromeExecutablePath() {
  const fromEnv =
    (typeof process.env.PUPPETEER_EXECUTABLE_PATH === "string" &&
      process.env.PUPPETEER_EXECUTABLE_PATH.trim()) ||
    (typeof process.env.PUPPETEER_EXECUTABLE === "string" &&
      process.env.PUPPETEER_EXECUTABLE.trim()) ||
    (typeof process.env.CHROME_BIN === "string" && process.env.CHROME_BIN.trim()) ||
    (typeof process.env.CHROMIUM_PATH === "string" && process.env.CHROMIUM_PATH.trim()) ||
    "";

  if (fromEnv) {
    const envPath = pickChromeExecutable([fromEnv]);
    if (envPath) return envPath;
    console.warn(
      `[whatsapp] configured browser path is missing or incompatible: ${fromEnv}`
    );
  }

  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    );
  }
  if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium"
    );
  }
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    );
  }

  const fromKnownPaths = pickChromeExecutable(candidates);
  if (fromKnownPaths) return fromKnownPaths;

  // Linux distributions often expose browser binaries only on PATH.
  if (process.platform === "linux") {
    const pathCandidates = [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
      "chrome",
    ];
    for (const cmd of pathCandidates) {
      try {
        const resolved = execSync(`command -v ${cmd}`, {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        })
          .trim()
          .split("\n")
          .pop();
        const fromPath = pickChromeExecutable([resolved]);
        if (fromPath) return fromPath;
      } catch {
        /* command not found */
      }
    }
  }

  // Last fallback: Puppeteer's own downloaded browser (if present and compatible).
  try {
    const puppeteer = require("puppeteer");
    if (puppeteer && typeof puppeteer.executablePath === "function") {
      const p = puppeteer.executablePath();
      if (typeof p === "string" && p.trim()) {
        const fromPuppeteer = pickChromeExecutable([p.trim()]);
        if (fromPuppeteer) return fromPuppeteer;
      }
    }
  } catch {
    /* ignore */
  }

  return "";
}

function formatBrowserLaunchHelp(baseMessage) {
  const tips = [
    "set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary path",
  ];

  if (process.platform === "linux") {
    if (os.arch() === "arm64" || os.arch() === "aarch64") {
      tips.push(
        "on ARM Linux install Chromium (e.g. apt install chromium-browser) and point PUPPETEER_EXECUTABLE_PATH at /usr/bin/chromium or /usr/bin/chromium-browser"
      );
      tips.push(
        "remove the broken Puppeteer cache: rm -rf ~/.cache/puppeteer/chrome/linux_arm-*"
      );
    } else {
      tips.push("install Google Chrome or Chromium via your package manager");
    }
  }

  if (/Syntax error|wrong CPU architecture|chrome-linux64/i.test(baseMessage)) {
    tips.unshift(
      "the configured/downloaded Chrome binary does not match this server's CPU architecture"
    );
  }

  if (/snap cgroup|snap\.chromium/i.test(baseMessage)) {
    tips.unshift(
      "snap Chromium cannot run under PM2/systemd — install apt Chromium (apt install chromium-browser) and set PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium or /usr/bin/chromium-browser"
    );
  }

  return `${baseMessage} | Tip: ${tips.join("; ")}.`;
}

function buildPuppeteerOptions(executablePath = "") {
  const args = [];

  // Sandbox flags are primarily needed in Linux container environments.
  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--no-zygote");
  }

  args.push(
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check"
  );

  const opts = {
    // Cold starts can exceed Puppeteer's default 30s on some machines.
    timeout: 120000,
    protocolTimeout: 120000,
    headless: true,
    args,
  };

  if (executablePath) {
    opts.executablePath = executablePath;
  }

  return opts;
}

function releaseLinuxProfileDir(profileDir) {
  if (process.platform !== "linux") return;
  if (!profileDir || !fs.existsSync(profileDir)) return;

  const lockArtifacts = ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"];
  for (const name of lockArtifacts) {
    const p = path.join(profileDir, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true, recursive: true });
    } catch {
      /* ignore stale lock cleanup errors */
    }
  }

  // If a crashed/restarted Node process left Chromium running with this exact profile,
  // terminate only those browser processes whose command line includes this profile path.
  const escapedDir = profileDir.replace(/["`\\$]/g, "\\$&");
  const escapedForGrep = escapedDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const lines = execSync("ps -eo pid,args", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => new RegExp(escapedForGrep).test(l))
      .filter((l) => /chrome|chromium/i.test(l));

    for (const line of lines) {
      const pid = Number(line.split(/\s+/, 1)[0]);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      try {
        execSync(`kill -TERM ${pid}`, { stdio: "ignore" });
      } catch {
        /* ignore if already gone */
      }
    }
  } catch {
    /* ignore process scan issues */
  }
}

function jidToConversationId(jid) {
  const safe = String(jid || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 100);
  return `wa_${safe}`;
}

/** Best-effort reverse of {@link jidToConversationId} when whatsappChatId was not persisted. */
function conversationIdToWhatsappJid(conversationId) {
  const safe = String(conversationId || "").trim();
  if (!safe.startsWith("wa_")) return "";
  const rest = safe.slice(3);
  if (!rest) return "";
  if (rest.endsWith("_c_us")) return `${rest.slice(0, -5)}@c.us`;
  if (rest.endsWith("_lid")) return `${rest.slice(0, -4)}@lid`;
  if (rest.endsWith("_g_us")) return `${rest.slice(0, -5)}@g.us`;
  const lastUnderscore = rest.lastIndexOf("_");
  if (lastUnderscore > 0) {
    const user = rest.slice(0, lastUnderscore);
    const suffix = rest.slice(lastUnderscore + 1);
    if (suffix === "us") return `${user}@c.us`;
    if (suffix === "lid") return `${user}@lid`;
    if (suffix.length <= 4) return `${user}@${suffix}`;
  }
  return "";
}

function toE164Phone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) return "";
  return `+${digits}`;
}

/** Resolve customer WhatsApp number with country code (E.164), including @lid privacy IDs. */
function pnToE164(pn) {
  const s = String(pn || "").trim();
  if (!s) return "";
  if (s.includes("@")) {
    const user = s.split("@")[0].split(":")[0];
    return toE164Phone(user);
  }
  return toE164Phone(s);
}

async function resolvePeerPhoneFromJid(client, jid, msg = null) {
  const id = typeof jid === "string" ? jid.trim() : "";
  if (!id || !client) return "";

  try {
    if (typeof client.getContactLidAndPhone === "function") {
      const rows = await client.getContactLidAndPhone([id]);
      for (const row of rows || []) {
        const fromPn = pnToE164(row?.pn);
        if (fromPn) return fromPn;
      }
    }
  } catch (e) {
    console.warn("[whatsapp] getContactLidAndPhone:", e instanceof Error ? e.message : String(e));
  }

  try {
    if (typeof client.getFormattedNumber === "function") {
      const formatted = await client.getFormattedNumber(id);
      const fromFormatted = toE164Phone(formatted);
      if (fromFormatted) return fromFormatted;
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof client.getContactById === "function") {
      const contact = await client.getContactById(id);
      if (contact) {
        const serialized =
          typeof contact.id?._serialized === "string" ? contact.id._serialized.trim() : "";
        if (serialized.endsWith("@c.us")) {
          const fromSerialized = pnToE164(serialized);
          if (fromSerialized) return fromSerialized;
        }
        const phoneNumberUser =
          typeof contact.phoneNumber?.user === "string" ? contact.phoneNumber.user.trim() : "";
        if (phoneNumberUser) {
          const fromPhoneNumber = toE164Phone(phoneNumberUser);
          if (fromPhoneNumber) return fromPhoneNumber;
        }
        if (typeof contact.getFormattedNumber === "function") {
          const formatted = await contact.getFormattedNumber();
          const fromFormatted = toE164Phone(formatted);
          if (fromFormatted) return fromFormatted;
        }
        const fromNumber = toE164Phone(contact.number);
        if (fromNumber) return fromNumber;
      }
    }
  } catch {
    /* ignore */
  }

  if (msg && typeof msg.getContact === "function") {
    try {
      const contact = await msg.getContact();
      if (contact) {
        if (typeof contact.getFormattedNumber === "function") {
          const formatted = await contact.getFormattedNumber();
          const fromFormatted = toE164Phone(formatted);
          if (fromFormatted) return fromFormatted;
        }
        const fromContact = toE164Phone(contact.number);
        if (fromContact) return fromContact;
      }
    } catch {
      /* ignore */
    }
  }

  if (id.endsWith("@lid")) return "";
  return pnToE164(id);
}

async function resolvePeerWhatsappPhone(client, msg) {
  const jid = typeof msg?.from === "string" ? msg.from.trim() : "";
  if (!jid) return "";
  return resolvePeerPhoneFromJid(client, jid, msg);
}

function channelLabelFromClient(client) {
  try {
    const info = client?.info;
    if (!info) return "";
    return (
      (typeof info.pushname === "string" && info.pushname.trim()) ||
      (info.wid && typeof info.wid.user === "string" && info.wid.user) ||
      ""
    );
  } catch {
    return "";
  }
}

async function profilePicDataUrlFromClient(client) {
  try {
    const wid = client?.info?.wid?._serialized;
    if (!wid || typeof client.getProfilePicUrl !== "function") return "";
    const picUrl = await client.getProfilePicUrl(wid);
    if (typeof picUrl !== "string" || !picUrl.trim()) return "";
    const res = await fetch(picUrl.trim());
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return "";
    const contentType =
      (typeof res.headers.get === "function" && res.headers.get("content-type")) || "image/jpeg";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * WhatsApp Web sends read receipts (`sendSeen`) before the actual message; if that step throws,
 * nothing is delivered. Disable seen + retry via alternate chat ids when needed.
 */
async function deliverTextToPeer(client, peerJid, text, options = {}) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const peer = typeof peerJid === "string" ? peerJid.trim() : "";
  if (!trimmed || !peer || !client) {
    return { ok: false, message: "Missing client, peer, or message text" };
  }

  const quoteId =
    typeof options.quotedMessageId === "string" ? options.quotedMessageId.trim() : "";

  const attempt = async (jid, sendOptions = {}) => {
    try {
      const sent = await client.sendMessage(jid, trimmed, { sendSeen: false, ...sendOptions });
      return Boolean(sent);
    } catch (e) {
      console.warn("[whatsapp] sendMessage:", e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  if (quoteId && (await attempt(peer, { quotedMessageId: quoteId }))) {
    return { ok: true };
  }
  if (await attempt(peer)) return { ok: true };

  try {
    if (typeof client.getChatById === "function") {
      const chat = await client.getChatById(peer);
      const cid = chat?.id?._serialized;
      if (cid && cid !== peer && (await attempt(cid))) return { ok: true };
    }
  } catch (e) {
    console.warn("[whatsapp] getChatById:", e instanceof Error ? e.message : String(e));
  }

  if (peer.endsWith("@lid") && typeof client.getContactLidAndPhone === "function") {
    try {
      const rows = await client.getContactLidAndPhone([peer]);
      for (const row of rows || []) {
        const pn = typeof row?.pn === "string" ? row.pn.trim() : "";
        if (pn && (await attempt(pn))) return { ok: true };
      }
    } catch (e) {
      console.warn("[whatsapp] getContactLidAndPhone:", e instanceof Error ? e.message : String(e));
    }
  }

  return { ok: false, message: "Message was not sent (chat unavailable or WhatsApp not ready?)" };
}

async function deliverAssistantText(client, msg, text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return false;
  const peer = typeof msg.from === "string" ? msg.from.trim() : "";
  if (!peer) return false;

  const quoteId =
    msg.id && typeof msg.id._serialized === "string" ? msg.id._serialized : "";

  const direct = await deliverTextToPeer(client, peer, trimmed, { quotedMessageId: quoteId });
  if (direct.ok) return true;

  try {
    const chat = await msg.getChat();
    const cid = chat?.id?._serialized;
    if (cid && cid !== peer) {
      const viaChat = await deliverTextToPeer(client, cid, trimmed);
      if (viaChat.ok) return true;
    }
  } catch (e) {
    console.warn("[whatsapp] getChat:", e instanceof Error ? e.message : String(e));
  }

  try {
    await msg.reply(trimmed, undefined, { sendSeen: false });
    return true;
  } catch (e) {
    console.warn("[whatsapp] msg.reply:", e instanceof Error ? e.message : String(e));
  }

  console.error("[whatsapp] failed to deliver assistant reply to peer", peer);
  return false;
}

const WHATSAPP_STALE_REPLY_MS = 2 * 60 * 1000;
/** Max recent messages to import per chat when syncing WhatsApp conversations. */
const WHATSAPP_SYNC_MESSAGE_LIMIT = 30;

function getWhatsAppMessageAgeMs(msg) {
  const ts = Number(msg?.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const messageMs = ts < 1e12 ? ts * 1000 : ts;
  return Math.max(0, Date.now() - messageMs);
}

function isStaleWhatsAppMessage(msg) {
  const ageMs = getWhatsAppMessageAgeMs(msg);
  if (ageMs <= 0) return false;
  return ageMs > WHATSAPP_STALE_REPLY_MS;
}

const MAX_WA_MEDIA_DATA_CHARS = 2_400_000;

async function attachmentsFromWhatsAppMessage(msg, sanitizeMessageAttachments) {
  if (!msg?.hasMedia || typeof msg.downloadMedia !== "function") return [];
  try {
    const media = await msg.downloadMedia();
    const mimetype = typeof media?.mimetype === "string" ? media.mimetype.trim().toLowerCase() : "";
    const rawData = typeof media?.data === "string" ? media.data.replace(/\s/g, "") : "";
    const filename = typeof media?.filename === "string" ? media.filename.trim() : "";
    if (!mimetype || !rawData) return [];

    const dataUrl = `data:${mimetype};base64,${rawData}`;
    if (dataUrl.length > MAX_WA_MEDIA_DATA_CHARS) return [];

    let draft = null;
    if (mimetype.startsWith("image/")) {
      draft = [{ kind: "image", imageName: filename || "Image", imageData: dataUrl }];
    } else if (mimetype.startsWith("video/")) {
      draft = [{ kind: "video", videoName: filename || "Video", videoData: dataUrl }];
    } else if (mimetype === "application/pdf" || mimetype === "application/x-pdf") {
      draft = [{ kind: "pdf", pdfName: filename || "document.pdf", pdfData: dataUrl }];
    } else {
      draft = [{ kind: "file", fileName: filename || "File", mimeType: mimetype, fileData: dataUrl }];
    }
    return typeof sanitizeMessageAttachments === "function" ? sanitizeMessageAttachments(draft) : draft;
  } catch {
    return [];
  }
}

async function whatsappMessageToRecord(msg, sanitizeMessageAttachments) {
  const body = typeof msg?.body === "string" ? msg.body.trim() : "";
  const role = msg?.fromMe ? "assistant" : "user";
  const attachments = msg?.hasMedia
    ? await attachmentsFromWhatsAppMessage(msg, sanitizeMessageAttachments)
    : [];
  if (!body && !attachments.length) return null;
  const record = { role, content: body };
  if (attachments.length) record.attachments = attachments;
  const ts = Number(msg?.timestamp);
  if (Number.isFinite(ts) && ts > 0) {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    record.createdAt = new Date(ms).toISOString();
  }
  return record;
}

function priorMessagesFromSession(existing) {
  return (existing?.messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "agent"))
    .map((m) => {
      const row = {
        role: m.role,
        content: typeof m.content === "string" ? m.content : "",
      };
      if (Array.isArray(m.attachments) && m.attachments.length) {
        row.attachments = m.attachments;
      }
      return row;
    });
}

/**
 * @param {object} deps
 * @param {function} deps.completeWorkspaceChatTurn
 * @param {function} deps.sanitizeAgentDetailsUserId
 * @param {function} deps.getTestChatSessionByConversation
 * @param {function} deps.sanitizeChatMessages
 * @param {function} deps.sanitizeMessageAttachments
 * @param {function} deps.saveTestChatSession
 * @param {function} deps.mergeAgentMessagesPreservingOrder
 * @param {function} [deps.onAccountLinkedViaQr]
 */
function createWhatsAppBridge(deps) {
  const {
    completeWorkspaceChatTurn,
    sanitizeAgentDetailsUserId,
    getTestChatSessionByConversation,
    sanitizeChatMessages,
    sanitizeMessageAttachments,
    saveTestChatSession,
    mergeAgentMessagesPreservingOrder,
    onAccountLinkedViaQr,
  } = deps;

  /** @type {Map<string, object>} */
  const slots = new Map();
  /** @type {Set<string>} */
  const reconnecting = new Set();
  /** @type {Set<string>} */
  const syncingConversations = new Set();
  /** @type {Map<string, number>} consecutive failed auto-reconnect attempts per slot */
  const failedReconnectCounts = new Map();
  const MAX_AUTO_RECONNECT_FAILURES = 5;
  const waLog = (workspaceUserId, accountId, message, ...extra) => {
    const prefix = `[whatsapp][user:${workspaceUserId}][account:${accountId}]`;
    if (extra.length) {
      console.log(prefix, message, ...extra);
    } else {
      console.log(prefix, message);
    }
  };

  function removeAuthSession(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    const clientId = localAuthClientIdForAccount(safeAccountId);
    const sessionDir = resolveAccountSessionDir(safe, safeAccountId);
    const cacheDir = resolveUserWebCacheDir(safe, safeAccountId);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        waLog(safe, safeAccountId, "removed persisted auth session files");
      }
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        waLog(safe, safeAccountId, "removed persisted WhatsApp web cache files");
      }
    } catch (e) {
      waLog(
        safe,
        safeAccountId,
        "failed removing persisted auth session files",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  async function destroyClient(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    const key = slotKey(safe, safeAccountId);
    waLog(safe, safeAccountId, "destroying client session");
    const entry = slots.get(key);
    if (entry?.client) {
      try {
        entry.client.removeAllListeners();
        await entry.client.destroy();
      } catch {
        /* ignore */
      }
    }
    slots.delete(key);
    waLog(safe, safeAccountId, "client session removed");
  }

  async function disconnectAndForget(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (entry?.client) {
      try {
        waLog(safe, safeAccountId, "logging out linked WhatsApp Web device session");
        await entry.client.logout();
      } catch (e) {
        waLog(
          safe,
          safeAccountId,
          "logout call failed; continuing with local disconnect",
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    await destroyClient(safe, safeAccountId);
    removeAuthSession(safe, safeAccountId);
    whatsappAutoStart.removeLink(safe, safeAccountId);
  }

  function maybeRefreshProfilePic(entry) {
    if (!entry?.client || entry.phase !== "ready" || entry.profilePicLoading) return;
    if (typeof entry.profilePicDataUrl === "string" && entry.profilePicDataUrl) return;
    entry.profilePicLoading = true;
    void profilePicDataUrlFromClient(entry.client)
      .then((dataUrl) => {
        entry.profilePicDataUrl = typeof dataUrl === "string" ? dataUrl : "";
      })
      .finally(() => {
        entry.profilePicLoading = false;
      });
  }

  async function ensureConnected(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    if (!hasPersistedAccountSession(safe, safeAccountId)) return;

    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (entry?.phase === "ready") {
      failedReconnectCounts.delete(key);
      return;
    }
    if (
      entry &&
      ["initializing", "qr", "authenticated", "reconnecting"].includes(entry.phase)
    ) {
      return;
    }
    if (reconnecting.has(key)) return;

    const failCount = failedReconnectCounts.get(key) || 0;
    if (failCount >= MAX_AUTO_RECONNECT_FAILURES) {
      waLog(
        safe,
        safeAccountId,
        `giving up auto-reconnect after ${failCount} consecutive failures — clearing stale session`
      );
      removeAuthSession(safe, safeAccountId);
      whatsappAutoStart.removeLink(safe, safeAccountId);
      failedReconnectCounts.delete(key);
      slots.delete(key);
      return;
    }

    reconnecting.add(key);
    try {
      waLog(safe, safeAccountId, "auto-reconnecting persisted session");
      await startLinking(safe, safeAccountId);
    } catch (e) {
      failedReconnectCounts.set(key, failCount + 1);
      waLog(
        safe,
        safeAccountId,
        "auto-reconnect failed",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      reconnecting.delete(key);
    }
  }

  function persistedReconnectPhase(workspaceUserId, accountId, entryPhase) {
    if (!hasPersistedAccountSession(workspaceUserId, accountId)) return entryPhase;
    if (entryPhase === "ready") return "ready";
    if (["disconnected", "error", "idle"].includes(entryPhase) || !entryPhase) {
      return "reconnecting";
    }
    return entryPhase;
  }

  function slotNeedsAutoReconnect(workspaceUserId, accountId, slotEntry) {
    if (!hasPersistedAccountSession(workspaceUserId, accountId)) return false;
    const key = slotKey(workspaceUserId, accountId);
    if ((failedReconnectCounts.get(key) || 0) >= MAX_AUTO_RECONNECT_FAILURES) return false;
    if (!slotEntry) return true;
    if (slotEntry.phase === "ready") return false;
    if (["initializing", "qr", "authenticated"].includes(slotEntry.phase)) return false;
    return ["disconnected", "error"].includes(slotEntry.phase);
  }

  function buildAccountStatus(workspaceUserId, accountId, entry) {
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const persisted = hasPersistedAccountSession(workspaceUserId, safeAccountId);
    if (!entry) {
      return {
        accountId: safeAccountId,
        label: `Account ${safeAccountId}`,
        phase: persisted ? "reconnecting" : "idle",
        connected: false,
        qrDataUrl: "",
        error: "",
        pushname: "",
        phone: "",
        profilePicDataUrl: "",
        persisted,
      };
    }
    return {
      accountId: safeAccountId,
      label: `Account ${safeAccountId}`,
      phase: persistedReconnectPhase(workspaceUserId, safeAccountId, entry.phase),
      connected: entry.phase === "ready",
      qrDataUrl: entry.qrDataUrl || "",
      error: entry.error || "",
      pushname: entry.pushname || "",
      phone: entry.phone || "",
      profilePicDataUrl: typeof entry.profilePicDataUrl === "string" ? entry.profilePicDataUrl : "",
      persisted,
    };
  }

  function getStatus(workspaceUserId, accountLimit = 1) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const limit = Math.max(1, Math.min(6, Number(accountLimit) || 1));
    if (!safe) {
      return {
        phase: "error",
        connected: false,
        connectedCount: 0,
        available: Boolean(Client),
        error: "Invalid user id",
        accounts: [],
        limit,
      };
    }

    const accounts = [];
    for (let i = 1; i <= limit; i += 1) {
      const accountId = String(i);
      const key = slotKey(safe, accountId);
      const slotEntry = slots.get(key);
      if (slotNeedsAutoReconnect(safe, accountId, slotEntry) && !reconnecting.has(key)) {
        void ensureConnected(safe, accountId);
      }
      if (slotEntry) maybeRefreshProfilePic(slotEntry);
      accounts.push(buildAccountStatus(safe, accountId, slotEntry));
    }

    const connectedCount = accounts.filter((account) => account.connected).length;
    const primary = accounts[0] || buildAccountStatus(safe, "1", null);

    return {
      ...primary,
      accounts,
      connectedCount,
      limit,
      available: Boolean(Client),
    };
  }

  async function syncSingleChatToSession(client, workspaceUserId, accountId, chat, label) {
    if (chat?.isGroup) return { action: "skipped", reason: "group" };

    const rawId = chat?.id;
    const jid =
      typeof rawId === "string"
        ? rawId.trim()
        : typeof rawId?._serialized === "string"
          ? rawId._serialized.trim()
          : "";
    if (!jid) return { action: "skipped", reason: "no_jid" };

    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const conversationId = jidToConversationId(jid);

    let waMessages = [];
    try {
      const fetched = await chat.fetchMessages({ limit: WHATSAPP_SYNC_MESSAGE_LIMIT });
      const sorted = (Array.isArray(fetched) ? fetched : []).sort(
        (a, b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0)
      );
      const records = await Promise.all(
        sorted.map((msg) => whatsappMessageToRecord(msg, sanitizeMessageAttachments))
      );
      waMessages = records.filter(Boolean);
    } catch (e) {
      waLog(
        safe,
        safeAccountId,
        "sync fetchMessages failed",
        e instanceof Error ? e.message : String(e)
      );
      return { action: "skipped", reason: "fetch_failed" };
    }

    if (!waMessages.length) return { action: "skipped", reason: "no_messages" };

    const existing = getTestChatSessionByConversation(safe, conversationId);
    const hadMessages = Array.isArray(existing?.messages) && existing.messages.length > 0;
    // Pass WA records through saveTestChatSession so createdAt/attachments are kept.
    const messagesToSave = hadMessages ? existing.messages : waMessages;

    let whatsappPeerPhone =
      typeof existing?.whatsappPeerPhone === "string" ? existing.whatsappPeerPhone.trim() : "";
    if (!whatsappPeerPhone) {
      whatsappPeerPhone = await resolvePeerPhoneFromJid(client, jid);
    }

    saveTestChatSession(safe, conversationId, messagesToSave, {
      chatSource: "whatsapp",
      channelAccountName: label,
      whatsappChatId: jid,
      whatsappPeerPhone,
      whatsappAccountId: safeAccountId,
    });

    return { action: hadMessages ? "updated" : "created" };
  }

  async function syncConversationsForAccount(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) {
      return { ok: false, accountId: safeAccountId, message: "Invalid user id" };
    }

    const key = slotKey(safe, safeAccountId);
    if (syncingConversations.has(key)) {
      return { ok: false, accountId: safeAccountId, message: "Sync already in progress" };
    }

    const entry = slots.get(key);
    if (!entry?.client || entry.phase !== "ready") {
      return {
        ok: false,
        accountId: safeAccountId,
        message: "WhatsApp account is not connected",
      };
    }

    syncingConversations.add(key);
    try {
      const client = entry.client;
      const label =
        channelLabelFromClient(client) ||
        entry.pushname ||
        entry.phone ||
        `WhatsApp ${safeAccountId}`;

      let chats = [];
      try {
        chats = await client.getChats();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        waLog(safe, safeAccountId, "sync getChats failed", msg);
        return { ok: false, accountId: safeAccountId, message: msg };
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const chat of Array.isArray(chats) ? chats : []) {
        try {
          const result = await syncSingleChatToSession(client, safe, safeAccountId, chat, label);
          if (result.action === "created") created += 1;
          else if (result.action === "updated") updated += 1;
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }

      waLog(
        safe,
        safeAccountId,
        `conversation sync complete (created=${created}, updated=${updated}, skipped=${skipped})`
      );
      return { ok: true, accountId: safeAccountId, created, updated, skipped };
    } finally {
      syncingConversations.delete(key);
    }
  }

  async function syncConversations(workspaceUserId, accountId = null) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    if (!safe) throw new Error("Invalid user id");

    const accountIds = [];
    if (accountId != null && String(accountId).trim()) {
      accountIds.push(sanitizeWhatsAppAccountId(accountId) || "1");
    } else {
      for (const [slotId, slotEntry] of slots.entries()) {
        if (!slotId.startsWith(`${safe}::`)) continue;
        if (!slotEntry?.client || slotEntry.phase !== "ready") continue;
        accountIds.push(slotId.split("::")[1] || "1");
      }
    }

    if (!accountIds.length) {
      return {
        ok: false,
        message: "No connected WhatsApp accounts to sync",
        created: 0,
        updated: 0,
        skipped: 0,
        results: [],
      };
    }

    const results = [];
    for (const aid of accountIds) {
      results.push(await syncConversationsForAccount(safe, aid));
    }

    return {
      ok: results.some((entry) => entry.ok),
      created: results.reduce((sum, entry) => sum + (Number(entry.created) || 0), 0),
      updated: results.reduce((sum, entry) => sum + (Number(entry.updated) || 0), 0),
      skipped: results.reduce((sum, entry) => sum + (Number(entry.skipped) || 0), 0),
      results,
    };
  }

  async function sendText(workspaceUserId, accountId, peerJid, text) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const body = typeof text === "string" ? text.trim() : "";
    const jid = typeof peerJid === "string" ? peerJid.trim() : "";
    if (!safe || !jid || !body) {
      return { ok: false, message: "Missing workspace user, WhatsApp peer, or message text" };
    }

    const tryOnClient = async (client) => {
      if (!client) return null;
      return deliverTextToPeer(client, jid, body);
    };

    const primaryKey = slotKey(safe, safeAccountId);
    const primary = slots.get(primaryKey);
    if (primary?.client && primary.phase === "ready") {
      const result = await tryOnClient(primary.client);
      if (result?.ok) return result;
      if (result && !result.ok) {
        waLog(safe, safeAccountId, "live-agent send failed on primary account", result.message || "");
      }
    } else {
      waLog(
        safe,
        safeAccountId,
        `live-agent send skipped: WhatsApp account not ready (phase=${primary?.phase || "missing"})`
      );
    }

    for (const [slotId, slotEntry] of slots.entries()) {
      if (slotId === primaryKey) continue;
      if (!slotId.startsWith(`${safe}:`)) continue;
      if (!slotEntry?.client || slotEntry.phase !== "ready") continue;
      const accountFromSlot = slotId.split("::")[1] || safeAccountId;
      const result = await tryOnClient(slotEntry.client);
      if (result?.ok) {
        waLog(safe, accountFromSlot, "live-agent send succeeded via fallback linked account");
        return result;
      }
    }

    return {
      ok: false,
      message:
        primary?.phase === "ready"
          ? "Message was not sent (chat unavailable?)"
          : "WhatsApp is not connected. Link the account and try again.",
    };
  }

  async function startLinking(workspaceUserId, accountId = "1", options = {}) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const linkIntent = options.linkIntent === "user_qr" ? "user_qr" : "auto_restore";
    if (!safe) throw new Error("Invalid user id");
    if (!Client || !LocalAuth) {
      throw new Error("whatsapp-web.js is not installed. Run npm install in the backend folder.");
    }
    const key = slotKey(safe, safeAccountId);
    const existingSlot = slots.get(key);
    if (existingSlot?.phase === "ready") {
      waLog(safe, safeAccountId, "already linked and ready");
      return { ok: true, alreadyConnected: true };
    }
    if (
      existingSlot?.client &&
      ["initializing", "qr", "authenticated"].includes(existingSlot.phase)
    ) {
      waLog(safe, safeAccountId, `linking already in progress (phase=${existingSlot.phase})`);
      return { ok: true, pending: true };
    }
    waLog(safe, safeAccountId, "starting linking flow (initializing client)");
    await destroyClient(safe, safeAccountId);

    const entry = {
      accountId: safeAccountId,
      phase: "initializing",
      qrDataUrl: "",
      error: "",
      pushname: "",
      phone: "",
      profilePicDataUrl: "",
      linkIntent,
      client: null,
    };
    slots.set(key, entry);

    const executablePath = resolveChromeExecutablePath();
    if (!executablePath) {
      waLog(
        safe,
        safeAccountId,
        "no explicit browser executable detected; trying Puppeteer default browser resolution"
      );
    } else {
      waLog(safe, safeAccountId, `using browser executable: ${executablePath}`);
    }

    const authRoot = resolveUserAuthRoot(safe);
    const webCachePath = resolveUserWebCacheDir(safe, safeAccountId);
    const localAuthClientId = localAuthClientIdForAccount(safeAccountId);
    const localAuthProfileDir = path.join(authRoot, `session-${localAuthClientId}`);
    releaseLinuxProfileDir(localAuthProfileDir);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: localAuthClientId,
        dataPath: authRoot,
      }),
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      restartOnAuthFail: true,
      webVersionCache: {
        type: "local",
        path: webCachePath,
      },
      puppeteer: buildPuppeteerOptions(executablePath),
    });

    entry.client = client;

    client.on("qr", async (qr) => {
      try {
        entry.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 });
        entry.phase = "qr";
        waLog(safe, safeAccountId, "qr generated; waiting for device link scan");
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        entry.phase = "error";
        waLog(safe, safeAccountId, "failed generating qr", entry.error);
      }
    });

    client.on("authenticated", () => {
      entry.phase = "authenticated";
      entry.qrDataUrl = "";
      whatsappAutoStart.addLink(safe, safeAccountId);
      waLog(safe, safeAccountId, "account login authenticated");
    });

    client.on("auth_failure", (m) => {
      entry.phase = "error";
      entry.error = String(m || "auth_failure");
      waLog(safe, safeAccountId, "auth failure", entry.error);
    });

    client.on("ready", () => {
      entry.phase = "ready";
      entry.qrDataUrl = "";
      const wid = client.info?.wid;
      entry.phone = wid?.user || "";
      entry.pushname = channelLabelFromClient(client);
      failedReconnectCounts.delete(key);
      whatsappAutoStart.addLink(safe, safeAccountId);
      if (entry.linkIntent === "user_qr" && typeof onAccountLinkedViaQr === "function") {
        onAccountLinkedViaQr(safe, safeAccountId, {
          pushname: entry.pushname,
          phone: entry.phone,
          label: `Account ${safeAccountId}`,
        });
      }
      entry.linkIntent = "auto_restore";
      void profilePicDataUrlFromClient(client).then((dataUrl) => {
        entry.profilePicDataUrl = typeof dataUrl === "string" ? dataUrl : "";
      });
      waLog(
        safe,
        safeAccountId,
        `linked and ready (account=${entry.pushname || "unknown"}${entry.phone ? ` · ${entry.phone}` : ""})`
      );
      setTimeout(() => {
        void syncConversationsForAccount(safe, safeAccountId).catch((e) => {
          waLog(
            safe,
            safeAccountId,
            "auto conversation sync failed",
            e instanceof Error ? e.message : String(e)
          );
        });
      }, 3000);
    });

    client.on("disconnected", (reason) => {
      entry.phase = "disconnected";
      entry.error = String(reason || "disconnected");
      waLog(safe, safeAccountId, "disconnected", entry.error);
      const prevFails = failedReconnectCounts.get(key) || 0;
      failedReconnectCounts.set(key, prevFails + 1);
      if (hasPersistedAccountSession(safe, safeAccountId)) {
        setTimeout(() => {
          void ensureConnected(safe, safeAccountId);
        }, 5000);
      }
    });

    client.on("message", async (msg) => {
      if (msg.fromMe) return;
      try {
        const chat = await msg.getChat();
        if (chat.isGroup) return;
      } catch {
        /* ignore */
      }

      const jid = msg.from;
      const conversationId = jidToConversationId(jid);

      const entryNow = slots.get(key);
      const label =
        channelLabelFromClient(client) ||
        (entryNow && entryNow.pushname) ||
        (entryNow && entryNow.phone) ||
        `WhatsApp ${safeAccountId}`;

      if (isStaleWhatsAppMessage(msg)) {
        const incomingStale = await whatsappMessageToRecord(msg, sanitizeMessageAttachments);
        if (incomingStale) {
          const existingStale = getTestChatSessionByConversation(safe, conversationId);
          const priorStale = priorMessagesFromSession(existingStale).filter(
            (m) => m.role === "user" || m.role === "assistant"
          );
          const messagesStale = mergeAgentMessagesPreservingOrder
            ? mergeAgentMessagesPreservingOrder(existingStale?.messages, [...priorStale, incomingStale])
            : [...priorStale, incomingStale];
          const whatsappPeerPhoneStale = await resolvePeerWhatsappPhone(client, msg);
          saveTestChatSession(safe, conversationId, messagesStale, {
            chatSource: "whatsapp",
            channelAccountName: label,
            whatsappChatId: jid,
            whatsappPeerPhone: whatsappPeerPhoneStale,
            whatsappAccountId: safeAccountId,
          });
        }
        waLog(
          safe,
          safeAccountId,
          `skipped auto-reply for stale message (${Math.round(getWhatsAppMessageAgeMs(msg) / 1000)}s old)`
        );
        return;
      }

      const incomingRecord = await whatsappMessageToRecord(msg, sanitizeMessageAttachments);
      if (!incomingRecord) return;

      const existing = getTestChatSessionByConversation(safe, conversationId);
      const prior = priorMessagesFromSession(existing).filter(
        (m) => m.role === "user" || m.role === "assistant"
      );
      const whatsappPeerPhone = await resolvePeerWhatsappPhone(client, msg);
      const sessionOpts = {
        chatSource: "whatsapp",
        channelAccountName: label,
        whatsappChatId: jid,
        whatsappPeerPhone,
        whatsappAccountId: safeAccountId,
      };

      if (!incomingRecord.content) {
        const messagesMediaOnly = mergeAgentMessagesPreservingOrder
          ? mergeAgentMessagesPreservingOrder(existing?.messages, [...prior, incomingRecord])
          : [...prior, incomingRecord];
        saveTestChatSession(safe, conversationId, messagesMediaOnly, sessionOpts);
        return;
      }

      const messagesForAi = sanitizeChatMessages([
        ...prior,
        {
          role: "user",
          content: incomingRecord.content,
          ...(incomingRecord.createdAt ? { createdAt: incomingRecord.createdAt } : {}),
        },
      ]);

      const result = await completeWorkspaceChatTurn({
        userId: safe,
        conversationId,
        messages: messagesForAi,
        ...sessionOpts,
      });

      if (Array.isArray(incomingRecord.attachments) && incomingRecord.attachments.length) {
        const refreshed = getTestChatSessionByConversation(safe, conversationId);
        if (refreshed?.messages?.length) {
          const patched = [...refreshed.messages];
          for (let i = patched.length - 1; i >= 0; i -= 1) {
            if (patched[i]?.role === "user") {
              patched[i] = { ...patched[i], attachments: incomingRecord.attachments };
              break;
            }
          }
          saveTestChatSession(safe, conversationId, patched, {
            ...sessionOpts,
            liveAgentEnabled: Boolean(refreshed.liveAgentEnabled),
          });
        }
      }

      if (result.kind === "success" && typeof result.reply === "string" && result.reply.trim()) {
        await deliverAssistantText(client, msg, result.reply);
        return;
      }

      if (result.kind === "live_agent" || result.kind === "ai_disabled") {
        return;
      }

      const fallbackCopy = (() => {
        if (result.kind === "openai_missing") {
          return (
            "Automatic replies aren't available — the server has no AI API key configured. " +
            "Your message was saved; please contact the workspace owner."
          );
        }
        if (result.kind === "error") {
          return (
            "Sorry — I couldn't generate a reply right now. Your message was saved; please try again shortly."
          );
        }
        if (result.kind === "validation_error") {
          return "";
        }
        return "";
      })();

      if (fallbackCopy) {
        await deliverAssistantText(client, msg, fallbackCopy);
      }
    });

    try {
      await client.initialize();
      waLog(safe, safeAccountId, "client initialize() called successfully");
    } catch (e) {
      entry.phase = "error";
      const message = e instanceof Error ? e.message : String(e);
      entry.error = formatBrowserLaunchHelp(
        "Failed to launch browser for WhatsApp Web. " + message
      );
      waLog(safe, safeAccountId, "initialize failed", entry.error);
      return { ok: false, error: entry.error };
    }

    return { ok: true };
  }

  async function regenerateQr(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) throw new Error("Invalid user id");
    if (!Client || !LocalAuth) {
      throw new Error("whatsapp-web.js is not installed. Run npm install in the backend folder.");
    }
    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (entry?.phase === "ready") {
      throw new Error("Account is already connected. Disconnect first to link a new device.");
    }
    waLog(safe, safeAccountId, "regenerating QR code");
    await destroyClient(safe, safeAccountId);
    removeAuthSession(safe, safeAccountId);
    reconnecting.delete(key);
    return startLinking(safe, safeAccountId, { linkIntent: "user_qr" });
  }

  async function resolvePeerPhone(workspaceUserId, accountId, jid) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return "";
    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (entry?.client && entry.phase === "ready") {
      const phone = await resolvePeerPhoneFromJid(entry.client, jid);
      if (phone) return phone;
    }
    for (const [slotId, slotEntry] of slots.entries()) {
      if (!slotId.startsWith(`${safe}:`)) continue;
      if (!slotEntry?.client || slotEntry.phase !== "ready") continue;
      const phone = await resolvePeerPhoneFromJid(slotEntry.client, jid);
      if (phone) return phone;
    }
    return "";
  }

  async function resolvePeerPhoneForSession(workspaceUserId, session) {
    const jid =
      session && typeof session.whatsappChatId === "string" ? session.whatsappChatId.trim() : "";
    if (!jid) return "";
    const accountId =
      session && typeof session.whatsappAccountId === "string" ? session.whatsappAccountId : "1";
    return resolvePeerPhone(workspaceUserId, accountId, jid);
  }

  async function shutdownAll() {
    const keys = [...slots.keys()];
    await Promise.allSettled(
      keys.map((key) => {
        const parts = key.split("::");
        if (parts.length !== 2) return Promise.resolve();
        return destroyClient(parts[0], parts[1]);
      })
    );
  }

  async function waitForSlotPhase(workspaceUserId, accountId, acceptPhases, timeoutMs = 180000) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return { ok: false, phase: "invalid_user" };
    const key = slotKey(safe, safeAccountId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entry = slots.get(key);
      if (!entry) return { ok: false, phase: "missing" };
      if (acceptPhases.includes(entry.phase)) {
        return { ok: true, phase: entry.phase, entry };
      }
      if (entry.phase === "error") {
        return { ok: false, phase: "error", error: entry.error || "error" };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const entry = slots.get(key);
    return {
      ok: false,
      phase: entry?.phase || "timeout",
      error: "Timed out waiting for WhatsApp connection",
    };
  }

  /**
   * Reconnect persisted LocalAuth sessions after server boot (sequential to avoid Chrome overload).
   */
  async function restorePersistedConnections(links = null, options = {}) {
    const toRestore = Array.isArray(links) ? links : whatsappAutoStart.readRestoreLinks();
    const staggerMs = Number(options.staggerMs) >= 0 ? Number(options.staggerMs) : 3000;
    const readyTimeoutMs = Number(options.readyTimeoutMs) > 0 ? Number(options.readyTimeoutMs) : 180000;
    const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 3;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = [];

    for (let i = 0; i < toRestore.length; i += 1) {
      const link = toRestore[i];
      const uid = sanitizeAgentDetailsUserId(String(link.userId || "").trim());
      const accountId = sanitizeWhatsAppAccountId(link.accountId) || "1";
      if (!uid) continue;

      if (!hasPersistedAccountSession(uid, accountId)) {
        waLog(uid, accountId, "skip restore: no persisted session on disk");
        results.push({ userId: uid, accountId, ok: false, reason: "no_session" });
        continue;
      }

      let restored = false;
      let lastReason = "";

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          waLog(uid, accountId, `restore attempt ${attempt}/${maxAttempts}`);
          const startResult = await startLinking(uid, accountId);
          if (!startResult?.ok) {
            lastReason = startResult?.error || "initialize_failed";
            if (attempt < maxAttempts) {
              await sleep(4000 * attempt);
              continue;
            }
            break;
          }

          if (startResult.alreadyConnected) {
            restored = true;
            break;
          }

          const wait = await waitForSlotPhase(uid, accountId, ["ready"], readyTimeoutMs);
          if (wait.ok && wait.phase === "ready") {
            restored = true;
            break;
          }

          const phaseNow = slots.get(slotKey(uid, accountId))?.phase || wait.phase;
          if (phaseNow === "qr") {
            lastReason = "session_expired_needs_qr";
            break;
          }
          lastReason = wait.error || phaseNow || "not_ready";
        } catch (e) {
          lastReason = e instanceof Error ? e.message : String(e);
        }

        if (attempt < maxAttempts) {
          const delayMs = 4000 * attempt;
          waLog(uid, accountId, `restore retry in ${delayMs}ms`, lastReason);
          await sleep(delayMs);
        }
      }

      if (restored) {
        failedReconnectCounts.delete(slotKey(uid, accountId));
        waLog(uid, accountId, "persisted session restored");
        results.push({ userId: uid, accountId, ok: true });
      } else {
        waLog(uid, accountId, "restore failed", lastReason || "unknown");
        removeAuthSession(uid, accountId);
        whatsappAutoStart.removeLink(uid, accountId);
        failedReconnectCounts.delete(slotKey(uid, accountId));
        const staleKey = slotKey(uid, accountId);
        const staleEntry = slots.get(staleKey);
        if (staleEntry && staleEntry.phase !== "ready") {
          slots.delete(staleKey);
        }
        waLog(uid, accountId, "cleared stale session files after failed restore");
        results.push({ userId: uid, accountId, ok: false, reason: lastReason || "unknown" });
      }

      if (staggerMs > 0 && i < toRestore.length - 1) {
        await sleep(staggerMs);
      }
    }

    return results;
  }

  function startBackgroundReconnectLoop() {
    const intervalMs = 30000;
    const timer = setInterval(() => {
      whatsappAutoStart.readRestoreLinks().forEach((link) => {
        const uid = sanitizeAgentDetailsUserId(String(link.userId || "").trim());
        const accountId = sanitizeWhatsAppAccountId(link.accountId) || "1";
        if (!uid) return;
        const key = slotKey(uid, accountId);
        const slotEntry = slots.get(key);
        if (!slotNeedsAutoReconnect(uid, accountId, slotEntry) || reconnecting.has(key)) return;
        void ensureConnected(uid, accountId);
      });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  startBackgroundReconnectLoop();

  return {
    startLinking,
    regenerateQr,
    ensureConnected,
    restorePersistedConnections,
    hasPersistedSession: hasPersistedAccountSession,
    destroyClient,
    disconnectAndForget,
    getStatus,
    sendText,
    syncConversations,
    syncConversationsForAccount,
    resolvePeerPhone,
    resolvePeerPhoneForSession,
    shutdownAll,
    jidToConversationId,
    conversationIdToWhatsappJid,
    isLibraryAvailable: Boolean(Client),
  };
}

module.exports = {
  createWhatsAppBridge,
  jidToConversationId,
  conversationIdToWhatsappJid,
};
