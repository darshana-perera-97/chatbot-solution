const path = require("path");
const fs = require("fs");
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

function resolveChromeExecutablePath() {
  const fromEnv =
    (typeof process.env.PUPPETEER_EXECUTABLE_PATH === "string" &&
      process.env.PUPPETEER_EXECUTABLE_PATH.trim()) ||
    (typeof process.env.PUPPETEER_EXECUTABLE === "string" &&
      process.env.PUPPETEER_EXECUTABLE.trim()) ||
    (typeof process.env.CHROME_BIN === "string" && process.env.CHROME_BIN.trim()) ||
    (typeof process.env.CHROMIUM_PATH === "string" && process.env.CHROMIUM_PATH.trim()) ||
    "";
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (fromEnv) return "";

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
      "/usr/bin/chromium",
      "/snap/bin/chromium"
    );
  }
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

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
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch {
        /* command not found */
      }
    }
  }

  // Last fallback: Puppeteer's own downloaded browser (if present).
  try {
    const puppeteer = require("puppeteer");
    if (puppeteer && typeof puppeteer.executablePath === "function") {
      const p = puppeteer.executablePath();
      if (typeof p === "string" && p.trim() && fs.existsSync(p)) {
        return p.trim();
      }
    }
  } catch {
    /* ignore */
  }

  return "";
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
 * nothing is delivered. Disable seen + retry without quote when needed.
 */
async function deliverAssistantText(client, msg, text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return false;
  const peer = typeof msg.from === "string" ? msg.from.trim() : "";
  if (!peer) return false;

  const quoteId =
    msg.id && typeof msg.id._serialized === "string" ? msg.id._serialized : "";

  const attempt = async (options) => {
    try {
      const sent = await client.sendMessage(peer, trimmed, options);
      return Boolean(sent);
    } catch (e) {
      console.warn("[whatsapp] sendMessage:", e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  if (quoteId && (await attempt({ quotedMessageId: quoteId, sendSeen: false }))) return true;
  if (await attempt({ sendSeen: false })) return true;

  try {
    const chat = await msg.getChat();
    const cid = chat?.id?._serialized;
    if (cid && cid !== peer) {
      try {
        const sent = await client.sendMessage(cid, trimmed, { sendSeen: false });
        if (sent) return true;
      } catch (e) {
        console.warn("[whatsapp] send via chat id:", e instanceof Error ? e.message : String(e));
      }
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

/**
 * @param {object} deps
 * @param {function} deps.completeWorkspaceChatTurn
 * @param {function} deps.sanitizeAgentDetailsUserId
 * @param {function} deps.getTestChatSessionByConversation
 * @param {function} deps.sanitizeChatMessages
 * @param {function} deps.saveTestChatSession
 */
function createWhatsAppBridge(deps) {
  const {
    completeWorkspaceChatTurn,
    sanitizeAgentDetailsUserId,
    getTestChatSessionByConversation,
    sanitizeChatMessages,
    saveTestChatSession,
  } = deps;

  /** @type {Map<string, object>} */
  const slots = new Map();
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

  function buildAccountStatus(workspaceUserId, accountId, entry) {
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!entry) {
      const persisted = hasPersistedAccountSession(workspaceUserId, safeAccountId);
      return {
        accountId: safeAccountId,
        label: `Account ${safeAccountId}`,
        phase: persisted ? "disconnected" : "idle",
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
      phase: entry.phase,
      connected: entry.phase === "ready",
      qrDataUrl: entry.qrDataUrl || "",
      error: entry.error || "",
      pushname: entry.pushname || "",
      phone: entry.phone || "",
      profilePicDataUrl: typeof entry.profilePicDataUrl === "string" ? entry.profilePicDataUrl : "",
      persisted: hasPersistedAccountSession(workspaceUserId, safeAccountId),
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

  async function sendText(workspaceUserId, accountId, peerJid, text) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const body = typeof text === "string" ? text.trim() : "";
    const jid = typeof peerJid === "string" ? peerJid.trim() : "";
    if (!safe || !jid || !body) return { ok: false };
    const entry = slots.get(slotKey(safe, safeAccountId));
    if (!entry?.client || entry.phase !== "ready") return { ok: false };
    try {
      const sent = await entry.client.sendMessage(jid, body, { sendSeen: false });
      if (!sent) return { ok: false, message: "Message was not sent (chat unavailable?)" };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async function startLinking(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
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
      whatsappAutoStart.addLink(safe, safeAccountId);
      void profilePicDataUrlFromClient(client).then((dataUrl) => {
        entry.profilePicDataUrl = typeof dataUrl === "string" ? dataUrl : "";
      });
      waLog(
        safe,
        safeAccountId,
        `linked and ready (account=${entry.pushname || "unknown"}${entry.phone ? ` · ${entry.phone}` : ""})`
      );
    });

    client.on("disconnected", (reason) => {
      entry.phase = "disconnected";
      entry.error = String(reason || "disconnected");
      waLog(safe, safeAccountId, "disconnected", entry.error);
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
      const body = typeof msg.body === "string" ? msg.body.trim() : "";

      const entryNow = slots.get(key);
      const label =
        channelLabelFromClient(client) ||
        (entryNow && entryNow.pushname) ||
        (entryNow && entryNow.phone) ||
        `WhatsApp ${safeAccountId}`;

      if (isStaleWhatsAppMessage(msg)) {
        if (body) {
          const existingStale = getTestChatSessionByConversation(safe, conversationId);
          const priorStale = (existingStale?.messages || [])
            .filter((m) => m && (m.role === "user" || m.role === "assistant"))
            .map((m) => ({
              role: m.role,
              content: typeof m.content === "string" ? m.content : "",
            }));
          const messagesStale = sanitizeChatMessages([...priorStale, { role: "user", content: body }]);
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

      if (!body) {
        if (msg.hasMedia) {
          try {
            await msg.reply("Thanks — this bot only handles text messages for now.");
          } catch {
            /* ignore */
          }
        }
        return;
      }

      const existing = getTestChatSessionByConversation(safe, conversationId);
      const prior = (existing?.messages || [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
        }));
      const messages = sanitizeChatMessages([...prior, { role: "user", content: body }]);
      const whatsappPeerPhone = await resolvePeerWhatsappPhone(client, msg);

      const result = await completeWorkspaceChatTurn({
        userId: safe,
        conversationId,
        messages,
        chatSource: "whatsapp",
        channelAccountName: label,
        whatsappChatId: jid,
        whatsappPeerPhone,
        whatsappAccountId: safeAccountId,
      });

      if (result.kind === "success" && typeof result.reply === "string" && result.reply.trim()) {
        await deliverAssistantText(client, msg, result.reply);
        return;
      }

      if (result.kind === "live_agent") {
        return;
      }

      const fallbackCopy = (() => {
        if (result.kind === "openai_missing") {
          return (
            "Automatic replies aren't available — the server has no AI API key configured. " +
            "Your message was saved; please contact the workspace owner."
          );
        }
        if (result.kind === "ai_disabled") {
          return (
            "AI auto-replies are turned off for this workspace. Your message was saved; an agent will follow up when available."
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
      entry.error =
        "Failed to launch browser for WhatsApp Web. " +
        message +
        " | Tip: set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary path.";
      waLog(safe, safeAccountId, "initialize failed", entry.error);
      return { ok: false, error: entry.error };
    }

    return { ok: true };
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

  return {
    startLinking,
    destroyClient,
    disconnectAndForget,
    getStatus,
    sendText,
    resolvePeerPhone,
    resolvePeerPhoneForSession,
    jidToConversationId,
    isLibraryAvailable: Boolean(Client),
  };
}

module.exports = {
  createWhatsAppBridge,
  jidToConversationId,
};
