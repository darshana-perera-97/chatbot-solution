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
    "--no-default-browser-check",
    // Chrome Memory Saver / site isolation can detach the WA Web frame after idle,
    // causing "Attempted to use detached Frame …" on sendMessage / page.evaluate.
    // Combine into one --disable-features (Chrome keeps only the last occurrence).
    "--disable-features=IsolateOrigins,site-per-process,MemorySaverMode",
    "--memory-pressure-off",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
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

function isTransientPuppeteerFrameError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /detached Frame|Execution context was destroyed|Session closed|Target closed|Protocol error/i.test(
    msg
  );
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** True for WhatsApp group JIDs (`…@g.us`) or conversation ids derived from them (`wa_…_g_us`). */
function isWhatsAppGroupJid(jidOrConversationId) {
  const raw = String(jidOrConversationId || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.endsWith("@g.us")) return true;
  if (raw.endsWith("_g_us")) return true;
  return false;
}

function chatJidFromChat(chat) {
  const rawId = chat?.id;
  if (typeof rawId === "string") return rawId.trim();
  if (typeof rawId?._serialized === "string") return rawId._serialized.trim();
  return "";
}

function isWhatsAppGroupChat(chat) {
  if (chat?.isGroup) return true;
  return isWhatsAppGroupJid(chatJidFromChat(chat));
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

/** Peer chat JID for inbound (`from`) or outbound (`to` / id.remote) personal messages. */
function peerJidFromWhatsAppMessage(msg) {
  if (msg?.fromMe) {
    const remote = typeof msg?.id?.remote === "string" ? msg.id.remote.trim() : "";
    if (remote) return remote;
    const to = typeof msg?.to === "string" ? msg.to.trim() : "";
    if (to) return to;
    return "";
  }
  return typeof msg?.from === "string" ? msg.from.trim() : String(msg?.from || "").trim();
}

async function resolvePeerWhatsappPhone(client, msg) {
  const jid = peerJidFromWhatsAppMessage(msg);
  if (!jid) return "";
  return resolvePeerPhoneFromJid(client, jid, msg);
}

/**
 * True when the session already has this outbound text (AI reply, live-agent send, or prior sync).
 * Avoids duplicating messages we ourselves just delivered via WhatsApp Web.
 */
function sessionAlreadyHasOutboundContent(existingMessages, content, attachmentsLength = 0) {
  const normalized = typeof content === "string" ? content.trim() : "";
  const attLen = Number(attachmentsLength) || 0;
  if (!normalized && !attLen) return true;
  const list = Array.isArray(existingMessages) ? existingMessages : [];
  const start = Math.max(0, list.length - 12);
  for (let i = list.length - 1; i >= start; i -= 1) {
    const m = list[i];
    if (!m || (m.role !== "assistant" && m.role !== "agent" && m.role !== "main_account")) {
      continue;
    }
    const c = typeof m.content === "string" ? m.content.trim() : "";
    const att = Array.isArray(m.attachments) ? m.attachments.length : 0;
    if (c === normalized && att === attLen) return true;
  }
  return false;
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

/** Build `digits@c.us` from E.164 / raw phone / pn JID for send fallbacks. */
function phoneToCusJid(rawPhone) {
  const s = String(rawPhone || "").trim();
  if (!s) return "";
  if (s.includes("@")) {
    const user = s.split("@")[0].split(":")[0].replace(/\D/g, "");
    return user.length >= 7 ? `${user}@c.us` : "";
  }
  const digits = s.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 18 ? `${digits}@c.us` : "";
}

/**
 * WhatsApp Web sends read receipts (`sendSeen`) before the actual message; if that step throws,
 * nothing is delivered. Disable seen + retry via alternate chat ids when needed.
 * Prefer stored peer phone / LID↔PN mapping because many chats are `@lid` and direct send fails.
 *
 * Note: whatsapp-web.js often resolves `undefined` even when the message was delivered (chat found
 * + send succeeded, but no message model returned). Treat non-throwing sends as success once the
 * chat resolves, and never retry other JIDs after that — retries can duplicate delivery.
 */
async function deliverTextToPeer(client, peerJid, text, options = {}) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const peer = typeof peerJid === "string" ? peerJid.trim() : "";
  if (!trimmed || !peer || !client) {
    return { ok: false, message: "Missing client, peer, or message text" };
  }

  const quoteId =
    typeof options.quotedMessageId === "string" ? options.quotedMessageId.trim() : "";
  const peerPhoneJid = phoneToCusJid(options.peerPhone);

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (jid) => {
    const id = typeof jid === "string" ? jid.trim() : "";
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  pushCandidate(peer);
  pushCandidate(peerPhoneJid);

  let lastError = "";

  const chatExists = async (jid) => {
    if (!client.pupPage) return null;
    try {
      return await client.pupPage.evaluate(async (chatId) => {
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
        return Boolean(chat);
      }, jid);
    } catch (e) {
      console.warn("[whatsapp] chatExists:", jid, e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const attempt = async (jid, sendOptions = {}) => {
    const maxTries = 3;
    for (let tryIndex = 0; tryIndex < maxTries; tryIndex += 1) {
      const exists = await chatExists(jid);
      if (exists === false) {
        lastError = `chat not found for ${jid}`;
        return false;
      }
      try {
        // waitUntilMsgSent improves odds of a Message return; library still often returns undefined
        // after a real delivery — do not use Boolean(sent).
        await client.sendMessage(jid, trimmed, {
          sendSeen: false,
          waitUntilMsgSent: true,
          ...sendOptions,
        });
        return true;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn("[whatsapp] sendMessage:", jid, lastError);
        if (!isTransientPuppeteerFrameError(e) || tryIndex >= maxTries - 1) {
          return false;
        }
        // Frame can recover after WhatsApp Web re-attaches; brief backoff then retry same JID.
        await sleepMs(750 * (tryIndex + 1));
      }
    }
    return false;
  };

  // Resolve alternate ids before the first send when possible (LID ↔ phone).
  if (typeof client.getContactLidAndPhone === "function") {
    try {
      const rows = await client.getContactLidAndPhone(
        [peer, peerPhoneJid].filter(Boolean)
      );
      for (const row of rows || []) {
        pushCandidate(typeof row?.lid === "string" ? row.lid.trim() : "");
        pushCandidate(typeof row?.pn === "string" ? row.pn.trim() : "");
        pushCandidate(phoneToCusJid(row?.pn));
      }
    } catch (e) {
      console.warn(
        "[whatsapp] getContactLidAndPhone:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  if (peerPhoneJid && typeof client.getNumberId === "function") {
    try {
      const numberId = await client.getNumberId(peerPhoneJid.replace(/@c\.us$/, ""));
      const serialized =
        typeof numberId?._serialized === "string"
          ? numberId._serialized.trim()
          : typeof numberId === "string"
            ? numberId.trim()
            : "";
      pushCandidate(serialized);
    } catch (e) {
      console.warn("[whatsapp] getNumberId:", e instanceof Error ? e.message : String(e));
    }
  }

  for (const jid of [...candidates]) {
    try {
      if (typeof client.getChatById === "function") {
        const chat = await client.getChatById(jid);
        const cid = chat?.id?._serialized;
        pushCandidate(cid);
      }
    } catch (e) {
      console.warn(
        "[whatsapp] getChatById:",
        jid,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  if (quoteId) {
    for (const jid of [...candidates]) {
      if (await attempt(jid, { quotedMessageId: quoteId })) return { ok: true };
    }
  }
  for (const jid of [...candidates]) {
    if (await attempt(jid)) return { ok: true };
  }

  return {
    ok: false,
    message: lastError
      ? `Message was not sent (${lastError})`
      : "Message was not sent (chat unavailable or WhatsApp not ready?)",
  };
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
/** Max recent messages to import per personal chat when syncing WhatsApp conversations. */
const WHATSAPP_SYNC_MESSAGE_LIMIT = 500;

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

function messageFingerprint(msg) {
  const role = typeof msg?.role === "string" ? msg.role : "";
  const content = typeof msg?.content === "string" ? msg.content.trim() : "";
  const createdAt = typeof msg?.createdAt === "string" ? msg.createdAt : "";
  const attCount = Array.isArray(msg?.attachments) ? msg.attachments.length : 0;
  return `${role}|${createdAt}|${content}|${attCount}`;
}

/**
 * Union WhatsApp history into an existing session without dropping live-agent rows
 * or duplicate messages already stored from prior sync / live receive.
 */
function mergeSyncedWhatsAppMessages(existingMessages, waMessages) {
  const existing = Array.isArray(existingMessages) ? existingMessages.filter(Boolean) : [];
  const incoming = Array.isArray(waMessages) ? waMessages.filter(Boolean) : [];
  if (!incoming.length) return existing;
  if (!existing.length) return incoming;

  const seen = new Set(existing.map(messageFingerprint));
  const merged = [...existing];
  for (const msg of incoming) {
    const key = messageFingerprint(msg);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(msg);
  }

  merged.sort((a, b) => {
    const ta = Date.parse(a?.createdAt || "") || 0;
    const tb = Date.parse(b?.createdAt || "") || 0;
    if (ta && tb && ta !== tb) return ta - tb;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return 0;
  });
  return merged;
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
  // Phone/desktop sends from the linked WhatsApp account (not AI / live-agent dashboard).
  const role = msg?.fromMe ? "main_account" : "user";
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
    .filter(
      (m) =>
        m &&
        (m.role === "user" ||
          m.role === "assistant" ||
          m.role === "agent" ||
          m.role === "main_account")
    )
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
  /** @type {Map<string, number>} last ensureConnected attempt timestamp */
  const lastReconnectAttemptAt = new Map();
  /** @type {Map<string, number>} backoff delay before next reconnect after disconnect */
  const reconnectBackoffMs = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} pending scheduled reconnect timers */
  const pendingReconnectTimers = new Map();
  /** @type {Map<string, number>} first seen timestamp for persisted session without a ready slot */
  const orphanedPersistedSince = new Map();
  /** @type {Map<string, number>} last watchdog force-restart timestamp per slot */
  const watchdogLastActionAt = new Map();
  /** @type {Set<string>} slots currently undergoing watchdog recovery */
  const watchdogRecovering = new Set();
  // Only count failed reconnect *attempts* (not transient disconnect events).
  // Transient WA/Chrome drops are common and must not wipe a healthy LocalAuth folder.
  // Only wipe LocalAuth after repeated QR/auth failures — not transient Chrome drops.
  const MAX_AUTO_RECONNECT_FAILURES = 30;
  const MIN_RECONNECT_INTERVAL_MS = 5000;
  const BASE_RECONNECT_DELAY_MS = 2000;
  const MAX_RECONNECT_DELAY_MS = 30000;
  const RECONNECT_READY_TIMEOUT_MS = 180000;
  const WATCHDOG_INTERVAL_MS = 30000;
  const WATCHDOG_STUCK_LINKING_MS = 120000;
  const WATCHDOG_MISSING_SLOT_MS = 45000;
  const WATCHDOG_DISCONNECTED_MS = 45000;
  const WATCHDOG_RECONNECT_LOCK_MS = RECONNECT_READY_TIMEOUT_MS + 45000;
  const WATCHDOG_ACTION_COOLDOWN_MS = 60000;
  const CONNECTION_HEALTH_INTERVAL_MS = 45000;
  const PAGE_KEEPALIVE_INTERVAL_MS = 15000;
  const BACKGROUND_RECONNECT_INTERVAL_MS = 10000;
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
    stopPageKeepAlive(entry);
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

  function stopPageKeepAlive(entry) {
    if (!entry?.keepAliveTimer) return;
    clearInterval(entry.keepAliveTimer);
    entry.keepAliveTimer = null;
  }

  function scheduleReconnect(workspaceUserId, accountId, reason = "disconnect") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe || !hasPersistedAccountSession(safe, safeAccountId)) return;
    const key = slotKey(safe, safeAccountId);
    if (pendingReconnectTimers.has(key) || reconnecting.has(key)) {
      waLog(safe, safeAccountId, `reconnect already pending; skip schedule (${reason})`);
      return;
    }
    const priorDelay = reconnectBackoffMs.get(key) || 0;
    const delay =
      priorDelay > 0
        ? Math.min(MAX_RECONNECT_DELAY_MS, Math.max(BASE_RECONNECT_DELAY_MS, priorDelay * 2))
        : BASE_RECONNECT_DELAY_MS;
    reconnectBackoffMs.set(key, delay);
    waLog(safe, safeAccountId, `scheduling reconnect in ${delay}ms (${reason})`);
    const timer = setTimeout(() => {
      pendingReconnectTimers.delete(key);
      void ensureConnected(safe, safeAccountId);
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    pendingReconnectTimers.set(key, timer);
  }

  function markSlotUnhealthy(entry, workspaceUserId, accountId, reason) {
    if (!entry) return;
    if (entry.phase !== "ready") return;
    waLog(workspaceUserId, accountId, `connection unhealthy (${reason}); scheduling reconnect`);
    setEntryPhase(entry, "disconnected");
    entry.error = reason;
    stopPageKeepAlive(entry);
    scheduleReconnect(workspaceUserId, accountId, reason);
  }

  function setEntryPhase(entry, phase) {
    if (!entry) return;
    if (entry.phase !== phase) {
      entry.phase = phase;
      entry.phaseSince = Date.now();
    }
  }

  function clearReconnectState(key) {
    failedReconnectCounts.delete(key);
    lastReconnectAttemptAt.delete(key);
    reconnectBackoffMs.delete(key);
    reconnecting.delete(key);
    const timer = pendingReconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingReconnectTimers.delete(key);
    }
  }

  /**
   * Periodically touch the WA Web page so Chrome Memory Saver does not detach the
   * Puppeteer frame (common cause of "Attempted to use detached Frame").
   */
  function startPageKeepAlive(entry, workspaceUserId, accountId) {
    stopPageKeepAlive(entry);
    if (!entry?.client) return;
    entry.keepAliveTimer = setInterval(() => {
      const page = entry.client?.pupPage;
      if (!page || entry.phase !== "ready") return;

      void (async () => {
        try {
          if (typeof entry.client.getState === "function") {
            const state = await entry.client.getState();
            if (state && state !== "CONNECTED") {
              markSlotUnhealthy(entry, workspaceUserId, accountId, `state_${String(state).toLowerCase()}`);
              return;
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isTransientPuppeteerFrameError(e)) {
            markSlotUnhealthy(entry, workspaceUserId, accountId, msg);
            return;
          }
        }

        void page
          .evaluate(() => Date.now())
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (!isTransientPuppeteerFrameError(e)) return;
            markSlotUnhealthy(entry, workspaceUserId, accountId, msg);
          });
      })();
    }, PAGE_KEEPALIVE_INTERVAL_MS);
    if (typeof entry.keepAliveTimer.unref === "function") {
      entry.keepAliveTimer.unref();
    }
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
    clearReconnectState(key);
    orphanedPersistedSince.delete(key);
    watchdogLastActionAt.delete(key);
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

  async function ensureConnected(workspaceUserId, accountId = "1", options = {}) {
    const force = Boolean(options && options.force);
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    if (!hasPersistedAccountSession(safe, safeAccountId)) return;

    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (entry?.phase === "ready") {
      clearReconnectState(key);
      return;
    }
    if (
      entry &&
      ["initializing", "qr", "authenticated", "reconnecting"].includes(entry.phase)
    ) {
      return;
    }
    if (reconnecting.has(key)) return;

    const now = Date.now();
    const lastAttemptAt = lastReconnectAttemptAt.get(key) || 0;
    if (entry && !force && now - lastAttemptAt < MIN_RECONNECT_INTERVAL_MS) return;

    const failCount = failedReconnectCounts.get(key) || 0;
    if (failCount >= MAX_AUTO_RECONNECT_FAILURES) {
      waLog(
        safe,
        safeAccountId,
        `auto-reconnect paused after ${failCount} consecutive QR/auth failures — scan QR in Integrations to relink`
      );
      return;
    }

    reconnecting.add(key);
    lastReconnectAttemptAt.set(key, now);
    try {
      waLog(safe, safeAccountId, "auto-reconnecting persisted session");
      const startResult = await startLinking(safe, safeAccountId);
      if (startResult?.alreadyConnected) {
        clearReconnectState(key);
        return;
      }
      if (startResult?.pending) {
        const wait = await waitForSlotPhase(
          safe,
          safeAccountId,
          ["ready", "qr"],
          RECONNECT_READY_TIMEOUT_MS
        );
        if (wait.ok && wait.phase === "ready") {
          clearReconnectState(key);
        }
        return;
      }

      // Hold the reconnect lock until ready / QR / error so status polls and the
      // background loop cannot destroy/recreate Chrome mid-restore.
      const wait = await waitForSlotPhase(
        safe,
        safeAccountId,
        ["ready", "qr"],
        RECONNECT_READY_TIMEOUT_MS
      );
      if (wait.ok && wait.phase === "ready") {
        clearReconnectState(key);
        return;
      }
      if (wait.phase === "qr") {
        failedReconnectCounts.set(key, failCount + 1);
        waLog(safe, safeAccountId, "auto-reconnect produced QR — session may be stale");
        return;
      }
      // Transient timeout / Chrome issues — retry without counting as auth failure.
      waLog(
        safe,
        safeAccountId,
        "auto-reconnect did not reach ready (will retry)",
        wait.error || wait.phase || "not_ready"
      );
    } catch (e) {
      waLog(
        safe,
        safeAccountId,
        "auto-reconnect failed (will retry)",
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
      const persisted = hasPersistedAccountSession(safe, accountId);
      if (persisted && (!slotEntry || slotEntry.phase !== "ready") && !reconnecting.has(key)) {
        void ensureConnected(safe, accountId);
      } else if (slotNeedsAutoReconnect(safe, accountId, slotEntry) && !reconnecting.has(key)) {
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
    if (isWhatsAppGroupChat(chat)) return { action: "skipped", reason: "group" };

    const jid = chatJidFromChat(chat);
    if (!jid) return { action: "skipped", reason: "no_jid" };
    if (isWhatsAppGroupJid(jid)) return { action: "skipped", reason: "group" };

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
    const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
    const hadMessages = existingMessages.length > 0;
    // Always merge WhatsApp personal-chat history so sync keeps receiving new messages.
    const messagesToSave = hadMessages
      ? mergeSyncedWhatsAppMessages(existingMessages, waMessages)
      : waMessages;

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

      // Personal chats only — never fetch or store WhatsApp group messages.
      const personalChats = (Array.isArray(chats) ? chats : []).filter(
        (chat) => !isWhatsAppGroupChat(chat)
      );
      skipped += (Array.isArray(chats) ? chats.length : 0) - personalChats.length;

      for (const chat of personalChats) {
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

  async function sendText(workspaceUserId, accountId, peerJid, text, options = {}) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const body = typeof text === "string" ? text.trim() : "";
    const jid = typeof peerJid === "string" ? peerJid.trim() : "";
    const peerPhone =
      typeof options.peerPhone === "string" ? options.peerPhone.trim() : "";
    if (!safe || !jid || !body) {
      return { ok: false, message: "Missing workspace user, WhatsApp peer, or message text" };
    }

    const tryOnClient = async (client) => {
      if (!client) return null;
      return deliverTextToPeer(client, jid, body, { peerPhone });
    };

    const primaryKey = slotKey(safe, safeAccountId);
    const primary = slots.get(primaryKey);
    let lastFailureMessage = "";
    if (primary?.client && primary.phase === "ready") {
      const result = await tryOnClient(primary.client);
      if (result?.ok) return result;
      if (result && !result.ok) {
        lastFailureMessage = result.message || "";
        waLog(safe, safeAccountId, "live-agent send failed on primary account", lastFailureMessage);
        if (isTransientPuppeteerFrameError(lastFailureMessage)) {
          setEntryPhase(primary, "disconnected");
          primary.error = lastFailureMessage;
          stopPageKeepAlive(primary);
          scheduleReconnect(safe, safeAccountId, "send_detached_frame");
        }
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
      if (!slotId.startsWith(`${safe}::`)) continue;
      if (!slotEntry?.client || slotEntry.phase !== "ready") continue;
      const accountFromSlot = slotId.split("::")[1] || safeAccountId;
      const result = await tryOnClient(slotEntry.client);
      if (result?.ok) {
        waLog(safe, accountFromSlot, "live-agent send succeeded via fallback linked account");
        return result;
      }
      if (result && !result.ok) lastFailureMessage = result.message || lastFailureMessage;
    }

    return {
      ok: false,
      message:
        primary?.phase === "ready"
          ? lastFailureMessage || "Message was not sent (chat unavailable?)"
          : "WhatsApp is not connected. Link the account used for this chat and try again.",
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
      phaseSince: Date.now(),
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
      // Prefer this server session, but give a brief window so a second Web client
      // does not thrash the link into a disconnect loop.
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10000,
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
        setEntryPhase(entry, "qr");
        waLog(safe, safeAccountId, "qr generated; waiting for device link scan");
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        setEntryPhase(entry, "error");
        waLog(safe, safeAccountId, "failed generating qr", entry.error);
      }
    });

    client.on("authenticated", () => {
      setEntryPhase(entry, "authenticated");
      entry.qrDataUrl = "";
      whatsappAutoStart.addLink(safe, safeAccountId);
      waLog(safe, safeAccountId, "account login authenticated");
    });

    client.on("auth_failure", (m) => {
      setEntryPhase(entry, "error");
      entry.error = String(m || "auth_failure");
      waLog(safe, safeAccountId, "auth failure", entry.error);
    });

    client.on("ready", () => {
      setEntryPhase(entry, "ready");
      entry.qrDataUrl = "";
      const wid = client.info?.wid;
      entry.phone = wid?.user || "";
      entry.pushname = channelLabelFromClient(client);
      failedReconnectCounts.delete(key);
      lastReconnectAttemptAt.delete(key);
      reconnectBackoffMs.delete(key);
      const pendingTimer = pendingReconnectTimers.get(key);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingReconnectTimers.delete(key);
      }
      whatsappAutoStart.addLink(safe, safeAccountId);
      startPageKeepAlive(entry, safe, safeAccountId);
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

    client.on("change_state", (state) => {
      const normalized = String(state || "").toUpperCase();
      if (!normalized) return;
      waLog(safe, safeAccountId, "change_state", normalized);
      if (normalized === "CONNECTED") {
        if (entry.phase !== "ready") setEntryPhase(entry, "ready");
        clearReconnectState(key);
        startPageKeepAlive(entry, safe, safeAccountId);
        return;
      }
      if (["OPENING", "PAIRING"].includes(normalized)) return;
      if (["CONFLICT", "TIMEOUT", "UNPAIRED", "TOS_BLOCK", "SMB_TOS_BLOCK", "PROXYBLOCK"].includes(normalized)) {
        markSlotUnhealthy(entry, safe, safeAccountId, `change_state_${normalized.toLowerCase()}`);
      }
    });

    client.on("disconnected", (reason) => {
      setEntryPhase(entry, "disconnected");
      entry.error = String(reason || "disconnected");
      stopPageKeepAlive(entry);
      waLog(safe, safeAccountId, "disconnected", entry.error);

      // Phone/desktop unlinked this Web session — local auth is no longer valid.
      if (/LOGOUT/i.test(entry.error)) {
        removeAuthSession(safe, safeAccountId);
        whatsappAutoStart.removeLink(safe, safeAccountId);
        clearReconnectState(key);
        return;
      }

      // Do not count transient disconnects as reconnect failures; only failed
      // ensureConnected attempts may eventually clear auth.
      scheduleReconnect(safe, safeAccountId, "disconnected");
    });

    /**
     * Persist messages sent from the linked WhatsApp phone/desktop (fromMe).
     * The `message` event does not fire for those; `message_create` does.
     * Do not run AI — only append to the conversation thread.
     */
    client.on("message_create", async (msg) => {
      if (!msg?.fromMe) return;

      const jid = peerJidFromWhatsAppMessage(msg);
      if (!jid || isWhatsAppGroupJid(jid)) return;

      try {
        const chat = await msg.getChat();
        if (isWhatsAppGroupChat(chat)) return;
      } catch {
        /* ignore */
      }

      try {
        const outboundRecord = await whatsappMessageToRecord(msg, sanitizeMessageAttachments);
        if (!outboundRecord) return;

        const conversationId = jidToConversationId(jid);
        const existing = getTestChatSessionByConversation(safe, conversationId);
        const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
        if (
          sessionAlreadyHasOutboundContent(
            existingMessages,
            outboundRecord.content,
            Array.isArray(outboundRecord.attachments) ? outboundRecord.attachments.length : 0
          )
        ) {
          return;
        }

        const entryNow = slots.get(key);
        const label =
          channelLabelFromClient(client) ||
          (entryNow && entryNow.pushname) ||
          (entryNow && entryNow.phone) ||
          `WhatsApp ${safeAccountId}`;

        // Append directly so main_account rows are not dropped by the agent-merge filter.
        const nextMessages = [...existingMessages, outboundRecord];

        let whatsappPeerPhone =
          typeof existing?.whatsappPeerPhone === "string" ? existing.whatsappPeerPhone.trim() : "";
        if (!whatsappPeerPhone) {
          whatsappPeerPhone = await resolvePeerPhoneFromJid(client, jid, msg);
        }

        saveTestChatSession(safe, conversationId, nextMessages, {
          chatSource: "whatsapp",
          channelAccountName: label,
          whatsappChatId: jid,
          whatsappPeerPhone,
          whatsappAccountId: safeAccountId,
          liveAgentEnabled: Boolean(existing?.liveAgentEnabled),
        });
      } catch (e) {
        waLog(
          safe,
          safeAccountId,
          "failed syncing outbound WhatsApp message",
          e instanceof Error ? e.message : String(e)
        );
      }
    });

    client.on("message", async (msg) => {
      if (msg.fromMe) return;

      const jid = peerJidFromWhatsAppMessage(msg);
      // Never read or store group messages — JID check covers getChat() failures.
      if (!jid || isWhatsAppGroupJid(jid)) return;

      try {
        const chat = await msg.getChat();
        if (isWhatsAppGroupChat(chat)) return;
      } catch {
        /* ignore */
      }

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
      const priorForAi = priorMessagesFromSession(existing)
        .filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "main_account"
        )
        .map((m) => (m.role === "main_account" ? { ...m, role: "assistant" } : m));
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
        ...priorForAi,
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
      setEntryPhase(entry, "error");
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
        const isSessionInvalid =
          lastReason === "session_expired_needs_qr" ||
          /auth.?fail/i.test(lastReason);
        if (isSessionInvalid) {
          removeAuthSession(uid, accountId);
          whatsappAutoStart.removeLink(uid, accountId);
          failedReconnectCounts.delete(slotKey(uid, accountId));
          const staleKey = slotKey(uid, accountId);
          const staleEntry = slots.get(staleKey);
          if (staleEntry && staleEntry.phase !== "ready") {
            slots.delete(staleKey);
          }
          waLog(uid, accountId, "cleared invalid session (reason: " + lastReason + ")");
        }
        results.push({ userId: uid, accountId, ok: false, reason: lastReason || "unknown" });
      }

      if (staggerMs > 0 && i < toRestore.length - 1) {
        await sleep(staggerMs);
      }
    }

    return results;
  }

  function watchdogCanAct(key, now) {
    if (watchdogRecovering.has(key)) return false;
    const lastAction = watchdogLastActionAt.get(key) || 0;
    return now - lastAction >= WATCHDOG_ACTION_COOLDOWN_MS;
  }

  function phaseAgeMs(entry, now) {
    const since = Number(entry?.phaseSince);
    if (Number.isFinite(since) && since > 0) return now - since;
    return Number.POSITIVE_INFINITY;
  }

  async function forceWatchdogRestart(workspaceUserId, accountId, reason) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe || !hasPersistedAccountSession(safe, safeAccountId)) return;
    const key = slotKey(safe, safeAccountId);
    const now = Date.now();
    if (!watchdogCanAct(key, now)) return;

    watchdogRecovering.add(key);
    watchdogLastActionAt.set(key, now);
    try {
      waLog(safe, safeAccountId, `watchdog: forcing reconnect (${reason})`);
      clearReconnectState(key);
      reconnectBackoffMs.delete(key);
      await destroyClient(safe, safeAccountId);
      orphanedPersistedSince.delete(key);
      void ensureConnected(safe, safeAccountId);
    } catch (e) {
      waLog(
        safe,
        safeAccountId,
        "watchdog restart failed",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      watchdogRecovering.delete(key);
    }
  }

  async function runConnectionWatchdog() {
    const now = Date.now();
    const links = whatsappAutoStart.readRestoreLinks();

    for (const link of links) {
      const uid = sanitizeAgentDetailsUserId(String(link.userId || "").trim());
      const accountId = sanitizeWhatsAppAccountId(link.accountId) || "1";
      if (!uid) continue;
      if (!hasPersistedAccountSession(uid, accountId)) {
        orphanedPersistedSince.delete(slotKey(uid, accountId));
        continue;
      }

      const key = slotKey(uid, accountId);
      if ((failedReconnectCounts.get(key) || 0) >= MAX_AUTO_RECONNECT_FAILURES) continue;
      if (!watchdogCanAct(key, now)) continue;

      const entry = slots.get(key);

      if (!entry) {
        const since = orphanedPersistedSince.get(key) || now;
        if (!orphanedPersistedSince.has(key)) orphanedPersistedSince.set(key, since);
        if (now - since >= WATCHDOG_MISSING_SLOT_MS) {
          await forceWatchdogRestart(uid, accountId, "missing_slot");
        }
        continue;
      }

      orphanedPersistedSince.delete(key);

      if (entry.phase === "ready") continue;

      const stuckMs = phaseAgeMs(entry, now);
      const reconnectLockAge = now - (lastReconnectAttemptAt.get(key) || 0);

      if (reconnecting.has(key) && reconnectLockAge >= WATCHDOG_RECONNECT_LOCK_MS) {
        await forceWatchdogRestart(uid, accountId, "stuck_reconnect_lock");
        continue;
      }

      if (["initializing", "authenticated"].includes(entry.phase) && stuckMs >= WATCHDOG_STUCK_LINKING_MS) {
        await forceWatchdogRestart(uid, accountId, `stuck_${entry.phase}`);
        continue;
      }

      if (
        entry.phase === "qr" &&
        entry.linkIntent !== "user_qr" &&
        stuckMs >= WATCHDOG_STUCK_LINKING_MS
      ) {
        await forceWatchdogRestart(uid, accountId, "stale_restore_qr");
        continue;
      }

      if (["disconnected", "error"].includes(entry.phase)) {
        const waitingOnTimer = pendingReconnectTimers.has(key);
        const reconnectInFlight = reconnecting.has(key);
        if (
          !waitingOnTimer &&
          !reconnectInFlight &&
          stuckMs >= WATCHDOG_DISCONNECTED_MS
        ) {
          await forceWatchdogRestart(uid, accountId, `stuck_${entry.phase}`);
        }
      }
    }
  }

  function startConnectionWatchdog() {
    const timer = setInterval(() => {
      void runConnectionWatchdog();
    }, WATCHDOG_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    waLog("system", "watchdog", `connection watchdog started (every ${WATCHDOG_INTERVAL_MS / 1000}s)`);
  }

  function listPersistedAccountLinks() {
    const seen = new Set();
    const links = [];
    whatsappAutoStart.readRestoreLinks().forEach((link) => {
      const uid = sanitizeAgentDetailsUserId(String(link.userId || "").trim());
      const accountId = sanitizeWhatsAppAccountId(link.accountId) || "1";
      if (!uid || !hasPersistedAccountSession(uid, accountId)) return;
      const key = slotKey(uid, accountId);
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ userId: uid, accountId });
    });
    return links;
  }

  async function runConnectionHealthCheck() {
    for (const [key, entry] of slots.entries()) {
      if (!entry || entry.phase !== "ready" || !entry.client) continue;
      const parts = String(key).split("::");
      if (parts.length !== 2) continue;
      const [uid, accountId] = parts;
      if (!hasPersistedAccountSession(uid, accountId)) continue;

      try {
        if (typeof entry.client.getState === "function") {
          const state = await entry.client.getState();
          if (state && state !== "CONNECTED") {
            markSlotUnhealthy(entry, uid, accountId, `health_state_${String(state).toLowerCase()}`);
            continue;
          }
        }
        const page = entry.client.pupPage;
        if (page) {
          await page.evaluate(() => document.hasFocus() || true);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isTransientPuppeteerFrameError(e)) {
          markSlotUnhealthy(entry, uid, accountId, `health_${msg.slice(0, 80)}`);
        }
      }
    }
  }

  function startConnectionHealthLoop() {
    const timer = setInterval(() => {
      void runConnectionHealthCheck();
    }, CONNECTION_HEALTH_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    waLog(
      "system",
      "health",
      `connection health loop started (every ${CONNECTION_HEALTH_INTERVAL_MS / 1000}s)`
    );
  }

  function startBackgroundReconnectLoop() {
    const timer = setInterval(() => {
      listPersistedAccountLinks().forEach((link) => {
        const uid = link.userId;
        const accountId = link.accountId;
        const key = slotKey(uid, accountId);
        const slotEntry = slots.get(key);
        if (slotEntry?.phase === "ready") return;
        if (!slotNeedsAutoReconnect(uid, accountId, slotEntry) && slotEntry) return;
        if (reconnecting.has(key)) return;
        void ensureConnected(uid, accountId);
      });
    }, BACKGROUND_RECONNECT_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    waLog(
      "system",
      "reconnect",
      `background reconnect loop started (every ${BACKGROUND_RECONNECT_INTERVAL_MS / 1000}s)`
    );
  }

  startBackgroundReconnectLoop();
  startConnectionHealthLoop();
  startConnectionWatchdog();

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
  isWhatsAppGroupJid,
};
