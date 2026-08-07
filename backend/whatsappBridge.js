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
/** Single shared WA Web HTML cache — same pinned version for every account (avoids N downloads on boot). */
const sharedWebCachePath = path.join(dataRoot, ".wwebjs_cache-shared");

/** Pin WA Web HTML — live web.whatsapp.com builds often hang at authenticated without firing ready. */
const WHATSAPP_WEB_VERSION =
  (typeof process.env.WHATSAPP_WEB_VERSION === "string" &&
    process.env.WHATSAPP_WEB_VERSION.trim()) ||
  "2.3000.1044135300-alpha";
const WA_VERSION_REMOTE_TEMPLATE =
  "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html";
/** After authenticated, ready should follow within this window or we recycle the browser session. */
const READY_AFTER_AUTH_TIMEOUT_MS = 30000;
const CONNECTION_PROBE_INTERVAL_MS = 2500;

function sanitizeWebCacheDir(webCachePath, pinnedVersion) {
  if (!webCachePath || !fs.existsSync(webCachePath)) return;
  const pinnedFile = `${pinnedVersion}.html`;
  for (const name of fs.readdirSync(webCachePath)) {
    if (!name.endsWith(".html") || name === pinnedFile) continue;
    try {
      fs.rmSync(path.join(webCachePath, name), { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function ensurePinnedWebVersionHtml(webCachePath, version) {
  if (!webCachePath || !version) return false;
  fs.mkdirSync(webCachePath, { recursive: true });
  const filePath = path.join(webCachePath, `${version}.html`);
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000) return true;
  } catch {
    /* re-download */
  }
  const url = WA_VERSION_REMOTE_TEMPLATE.replace("{version}", encodeURIComponent(version));
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not download WhatsApp Web ${version} (HTTP ${res.status})`);
  }
  const html = await res.text();
  if (!html || html.length < 10000) {
    throw new Error(`Downloaded WhatsApp Web ${version} looks invalid`);
  }
  fs.writeFileSync(filePath, html, "utf8");
  return true;
}

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

function resolveSharedWebCacheDir() {
  if (!fs.existsSync(sharedWebCachePath)) {
    fs.mkdirSync(sharedWebCachePath, { recursive: true });
  }
  return sharedWebCachePath;
}

function resolveUserWebCacheDir(workspaceUserId, accountId = "1") {
  return resolveSharedWebCacheDir();
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

let cachedChromeExecutablePath = undefined;

function resolveChromeExecutablePath() {
  if (cachedChromeExecutablePath !== undefined) return cachedChromeExecutablePath;

  const assignChromePath = (value) => {
    cachedChromeExecutablePath = value || "";
    return cachedChromeExecutablePath;
  };

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
    if (envPath) return assignChromePath(envPath);
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
  if (fromKnownPaths) return assignChromePath(fromKnownPaths);

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
        if (fromPath) return assignChromePath(fromPath);
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
        if (fromPuppeteer) return assignChromePath(fromPuppeteer);
      }
    }
  } catch {
    /* ignore */
  }

  return assignChromePath("");
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
    // Cold starts and getChats() over large chat lists can exceed Puppeteer's default 30s.
    timeout: 180000,
    protocolTimeout: 300000,
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

function isProtocolTimeoutError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Runtime\.callFunctionOn timed out|protocolTimeout/i.test(msg);
}

const GET_CHATS_MAX_ATTEMPTS = 3;
const GET_CHATS_RETRY_BASE_MS = 5000;

async function ensureClientPageResponsive(client) {
  if (!client?.pupPage) {
    throw new Error("WhatsApp page not available");
  }
  if (typeof client.getState === "function") {
    const state = await client.getState();
    if (state && state !== "CONNECTED") {
      throw new Error(`WhatsApp not connected (state=${state})`);
    }
  }
  await client.pupPage.evaluate(() => {
    if (!window.WWebJS || typeof window.require !== "function") {
      throw new Error("WhatsApp Web is still loading");
    }
    return Date.now();
  });
}

async function recoverClientPage(client) {
  if (!client?.pupPage) return false;
  try {
    await client.pupPage.evaluate(() => Date.now());
    return true;
  } catch {
    /* try a lightweight state probe */
  }
  try {
    if (typeof client.getState === "function") {
      const state = await client.getState();
      return state === "CONNECTED";
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Resolve a personal chat model — tries @lid, @c.us, and LID↔phone mappings with retries. */
async function resolveChatForPeerJid(client, peerJid, peerPhone = "") {
  if (!client || typeof client.getChatById !== "function") return null;
  const primary = typeof peerJid === "string" ? peerJid.trim() : "";
  if (!primary || isNonPersonalWhatsAppJid(primary)) return null;

  const candidates = [];
  const seen = new Set();
  const push = (jid) => {
    const id = typeof jid === "string" ? jid.trim() : "";
    if (!id || seen.has(id) || isNonPersonalWhatsAppJid(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(primary);
  push(phoneToCusJid(peerPhone));

  if (typeof client.getContactLidAndPhone === "function") {
    try {
      const rows = await client.getContactLidAndPhone([...candidates]);
      for (const row of rows || []) {
        push(typeof row?.lid === "string" ? row.lid : "");
        push(typeof row?.pn === "string" ? row.pn : "");
        push(phoneToCusJid(row?.pn));
      }
    } catch {
      /* ignore mapping errors */
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await recoverClientPage(client);
      await sleepMs(500 * attempt);
    }
    for (const jid of candidates) {
      try {
        const chat = await client.getChatById(jid);
        if (chat && !isNonPersonalWhatsAppChat(chat)) return chat;
      } catch (e) {
        if (!isTransientPuppeteerFrameError(e) && !isProtocolTimeoutError(e)) {
          continue;
        }
      }
    }
  }
  return null;
}

async function fetchClientChatsWithRetry(client, { maxAttempts = GET_CHATS_MAX_ATTEMPTS } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ensureClientPageResponsive(client);
      return await client.getChats();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable =
        isProtocolTimeoutError(e) ||
        isTransientPuppeteerFrameError(e) ||
        /still loading/i.test(msg);
      if (!retryable || attempt >= maxAttempts) {
        throw e instanceof Error ? e : new Error(msg);
      }
      if (isTransientPuppeteerFrameError(e)) {
        await recoverClientPage(client);
      }
      await sleepMs(GET_CHATS_RETRY_BASE_MS * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "getChats failed"));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser PIDs owned by live whatsapp-web.js clients — never kill during profile cleanup. */
const protectedWhatsAppBrowserPids = new Set();

function registerProtectedBrowserPid(pid) {
  const n = Number(pid);
  if (Number.isInteger(n) && n > 1) protectedWhatsAppBrowserPids.add(n);
}

function unregisterProtectedBrowserPid(pid) {
  const n = Number(pid);
  if (Number.isInteger(n) && n > 1) protectedWhatsAppBrowserPids.delete(n);
}

function readClientBrowserPid(client) {
  try {
    const proc = client?.pupBrowser?.process?.();
    const pid = proc?.pid;
    return Number.isInteger(pid) && pid > 1 ? pid : 0;
  } catch {
    return 0;
  }
}

function findChromePidsForProfile(profileDir) {
  const pids = new Set();
  if (!profileDir) return pids;

  const resolvedDir = resolveBinaryPath(profileDir);
  const profileCandidates = [...new Set([profileDir, resolvedDir].filter(Boolean))];

  if (process.platform === "darwin" || process.platform === "linux") {
    for (const dir of profileCandidates) {
      const needle = `--user-data-dir=${dir}`;
      try {
        const out = execSync(`pgrep -f ${JSON.stringify(needle)}`, {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        });
        for (const line of out.split("\n")) {
          const pid = Number(line.trim());
          if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) pids.add(pid);
        }
      } catch {
        /* pgrep returns exit 1 when nothing matches */
      }
    }
  }

  if (pids.size) return pids;

  const escapedForGrep = profileCandidates
    .map((dir) => dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!escapedForGrep) return pids;

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
      if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) pids.add(pid);
    }
  } catch {
    /* ignore */
  }

  return pids;
}

function isBrowserAlreadyRunningError(message) {
  const msg = String(message || "");
  return /browser is already running|user.?data.?dir|SingletonLock|profile appears to be in use/i.test(
    msg
  );
}

/**
 * Clear Chrome profile locks and terminate orphaned headless browsers still holding
 * this LocalAuth userDataDir after a Node crash/restart (Linux + macOS).
 */
function releaseStaleBrowserProfileDir(profileDir) {
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

  if (process.platform !== "linux" && process.platform !== "darwin") return;

  const pids = findChromePidsForProfile(profileDir);
  const orphanPids = [...pids].filter((pid) => !protectedWhatsAppBrowserPids.has(pid));
  if (!orphanPids.length) return;

  for (const pid of orphanPids) {
    try {
      execSync(`kill -TERM ${pid}`, { stdio: "ignore" });
    } catch {
      /* ignore if already gone */
    }
  }

  // Give Chrome a moment to exit cleanly, then force-kill stragglers.
  const waitUntil = Date.now() + 400;
  while (Date.now() < waitUntil) {
    /* brief spin — rare path during boot/reconnect cleanup */
  }

  for (const pid of orphanPids) {
    if (protectedWhatsAppBrowserPids.has(pid)) continue;
    try {
      execSync(`kill -0 ${pid}`, { stdio: "ignore" });
      execSync(`kill -KILL ${pid}`, { stdio: "ignore" });
    } catch {
      /* process already exited */
    }
  }

  for (const name of lockArtifacts) {
    const p = path.join(profileDir, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true, recursive: true });
    } catch {
      /* ignore */
    }
  }
}

/** Before boot restore, release every persisted WhatsApp Web profile on disk. */
function releaseAllPersistedBrowserProfiles() {
  try {
    if (!fs.existsSync(dataRoot)) return;
    for (const ent of fs.readdirSync(dataRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const authRoot = path.join(dataRoot, ent.name, "whatsapp-auth");
      if (!fs.existsSync(authRoot)) continue;
      for (const authEnt of fs.readdirSync(authRoot, { withFileTypes: true })) {
        if (!authEnt.isDirectory() || !authEnt.name.startsWith("session-")) continue;
        releaseStaleBrowserProfileDir(path.join(authRoot, authEnt.name));
      }
    }
  } catch {
    /* ignore scan errors */
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

/** True for WhatsApp Status / broadcast JIDs (e.g. `status@broadcast`). */
function isWhatsAppStatusJid(jidOrConversationId) {
  const raw = String(jidOrConversationId || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "status@broadcast") return true;
  if (raw.endsWith("@broadcast")) return true;
  if (raw.endsWith("_broadcast") || raw.includes("status_broadcast")) return true;
  return false;
}

/** True for WhatsApp channel / newsletter JIDs. */
function isWhatsAppChannelJid(jidOrConversationId) {
  const raw = String(jidOrConversationId || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.endsWith("@newsletter")) return true;
  if (raw.endsWith("_newsletter")) return true;
  return false;
}

/** Groups, channels, and status — not 1:1 personal chats. */
function isNonPersonalWhatsAppJid(jidOrConversationId) {
  return (
    isWhatsAppGroupJid(jidOrConversationId) ||
    isWhatsAppStatusJid(jidOrConversationId) ||
    isWhatsAppChannelJid(jidOrConversationId)
  );
}

function chatJidFromChat(chat) {
  const rawId = chat?.id;
  if (typeof rawId === "string") return rawId.trim();
  if (typeof rawId?._serialized === "string") return rawId._serialized.trim();
  return "";
}

function isWhatsAppGroupChat(chat) {
  return isNonPersonalWhatsAppChat(chat);
}

function isNonPersonalWhatsAppChat(chat) {
  if (!chat) return false;
  if (chat.isGroup) return true;
  if (chat.isChannel) return true;
  return isNonPersonalWhatsAppJid(chatJidFromChat(chat));
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
        return { ok: false, messageId: "" };
      }
      try {
        const sent = await client.sendMessage(jid, trimmed, {
          sendSeen: false,
          waitUntilMsgSent: true,
          ...sendOptions,
        });
        const messageId =
          typeof sent?.id?._serialized === "string" ? sent.id._serialized.trim() : "";
        return { ok: true, messageId };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn("[whatsapp] sendMessage:", jid, lastError);
        if (!isTransientPuppeteerFrameError(e) || tryIndex >= maxTries - 1) {
          return { ok: false, messageId: "" };
        }
        await sleepMs(750 * (tryIndex + 1));
      }
    }
    return { ok: false, messageId: "" };
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
      if (isTransientPuppeteerFrameError(e) || isProtocolTimeoutError(e)) continue;
      console.warn(
        "[whatsapp] getChatById:",
        jid,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  if (quoteId) {
    for (const jid of [...candidates]) {
      const result = await attempt(jid, { quotedMessageId: quoteId });
      if (result.ok) return { ok: true, messageId: result.messageId || "" };
    }
  }
  for (const jid of [...candidates]) {
    const result = await attempt(jid);
    if (result.ok) return { ok: true, messageId: result.messageId || "" };
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
/**
 * Max messages to import per personal chat when syncing WhatsApp conversations.
 * whatsapp-web.js loads earlier messages until this limit; 0 = no cap (Infinity).
 */
const WHATSAPP_SYNC_MESSAGE_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.WHATSAPP_SYNC_MESSAGE_LIMIT || "5000", 10) || 0
);

/** WhatsApp system messages — not real chat content; never persist or auto-reply. */
const IGNORED_WHATSAPP_MESSAGE_TYPES = new Set(["e2e_notification"]);

function isIgnoredWhatsAppMessage(msg) {
  const type = typeof msg?.type === "string" ? msg.type.trim().toLowerCase() : "";
  if (type && IGNORED_WHATSAPP_MESSAGE_TYPES.has(type)) return true;
  const body = typeof msg?.body === "string" ? msg.body.trim().toLowerCase() : "";
  if (body === "[e2e_notification]" || body === "e2e_notification") return true;
  if (msg?.isStatus) return true;
  const peer = peerJidFromWhatsAppMessage(msg);
  if (isNonPersonalWhatsAppJid(peer)) return true;
  const from = typeof msg?.from === "string" ? msg.from.trim() : "";
  const to = typeof msg?.to === "string" ? msg.to.trim() : "";
  if (isNonPersonalWhatsAppJid(from) || isNonPersonalWhatsAppJid(to)) return true;
  return false;
}

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

function normalizeWhatsAppMessageId(msg) {
  if (!msg?.id || msg.id._serialized) return;
  msg.id._serialized =
    msg.id.$1 || (typeof msg.id === "string" ? msg.id : null);
}

/** Resolve message in WhatsApp Web's Store before downloadMedia() (incl. @lid contacts). */
async function prepareWhatsAppMessageStoreForDownload(client, msg) {
  normalizeWhatsAppMessageId(msg);
  const page = client?.pupPage;
  if (!page || typeof page.evaluate !== "function") return;

  const msgId = msg.id?._serialized;
  const rawId = msg.id?.$1 || msg.id?._serialized;
  if (!msgId && !rawId) return;

  try {
    await page.evaluate(async (serializedId, alternateId) => {
      try {
        const MsgStore = window.Store && window.Store.Msg;
        if (!MsgStore) return;

        let targetMsg = MsgStore.get(serializedId) || MsgStore.get(alternateId);
        if (!targetMsg && MsgStore.getMessagesById) {
          const fetched = await MsgStore.getMessagesById([serializedId, alternateId]);
          if (fetched && fetched.length > 0) targetMsg = fetched[0];
        }

        if (targetMsg?.id && !targetMsg.id._serialized && targetMsg.id.$1) {
          targetMsg.id._serialized = targetMsg.id.$1;
        }
      } catch {
        /* browser-side resolution errors are non-fatal */
      }
    }, msgId, rawId);
  } catch {
    /* page evaluate failures are non-fatal */
  }
}

async function attachmentsFromWhatsAppMessage(msg, sanitizeMessageAttachments, client) {
  if (!msg?.hasMedia || typeof msg.downloadMedia !== "function") return [];
  try {
    await prepareWhatsAppMessageStoreForDownload(client, msg);
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
  } catch (e) {
    console.warn("[whatsapp] downloadMedia failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function whatsappMessageToRecord(msg, sanitizeMessageAttachments, client, options = {}) {
  if (isIgnoredWhatsAppMessage(msg)) return null;
  const body = typeof msg?.body === "string" ? msg.body.trim() : "";
  // Phone/desktop sends from the linked WhatsApp account (not AI / live-agent dashboard).
  const role = msg?.fromMe ? "main_account" : "user";
  const skipMedia = Boolean(options.skipMedia);
  const attachments =
    msg?.hasMedia && !skipMedia
      ? await attachmentsFromWhatsAppMessage(msg, sanitizeMessageAttachments, client)
      : [];
  let content = body;
  if (!content && attachments.length) {
    content = "";
  } else if (!content && msg?.hasMedia) {
    content = "[Media]";
  } else if (!content && typeof msg?.type === "string" && msg.type !== "chat") {
    content = `[${msg.type}]`;
  }
  if (!content && !attachments.length) return null;
  const record = { role, content };
  if (attachments.length) record.attachments = attachments;
  const waMessageId =
    typeof msg?.id?._serialized === "string"
      ? msg.id._serialized.trim()
      : typeof msg?.id === "string"
        ? msg.id.trim()
        : "";
  if (waMessageId) record.whatsappMessageId = waMessageId.slice(0, 200);
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
 * @param {function} deps.appendUniqueSessionMessages
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
    appendUniqueSessionMessages,
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
  /** @type {boolean} bulk boot restore in progress — defer per-account conversation sync */
  let bulkRestoreInProgress = false;
  // Only count failed reconnect *attempts* (not transient disconnect events).
  // Transient WA/Chrome drops are common and must not wipe a healthy LocalAuth folder.
  // Only wipe LocalAuth after repeated QR/auth failures — not transient Chrome drops.
  const MAX_AUTO_RECONNECT_FAILURES = 30;
  const MIN_RECONNECT_INTERVAL_MS = 5000;
  const BASE_RECONNECT_DELAY_MS = 2000;
  const MAX_RECONNECT_DELAY_MS = 30000;
  const RECONNECT_READY_TIMEOUT_MS = 180000;
  const WATCHDOG_INTERVAL_MS = 20000;
  const WATCHDOG_STUCK_LINKING_MS = 40000;
  const WATCHDOG_MISSING_SLOT_MS = 20000;
  const WATCHDOG_DISCONNECTED_MS = 45000;
  const WATCHDOG_RECONNECT_LOCK_MS = RECONNECT_READY_TIMEOUT_MS + 45000;
  const WATCHDOG_ACTION_COOLDOWN_MS = 60000;
  const CONNECTION_HEALTH_INTERVAL_MS = 45000;
  const PAGE_KEEPALIVE_INTERVAL_MS = 8000;
  const BACKGROUND_RECONNECT_INTERVAL_MS = 10000;
  const PERIODIC_CONVERSATION_SYNC_INTERVAL_MS = 180000;
  const ACCOUNT_SYNC_DEBOUNCE_MS = 15000;
  const CHAT_SYNC_DEBOUNCE_MS = 3000;
  const FRAME_GLITCH_RECONNECT_THRESHOLD = 3;
  const FRAME_GLITCH_WINDOW_MS = 90000;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} debounced full sync per account slot */
  const pendingAccountSyncTimers = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} debounced single-chat sync per jid */
  const pendingChatSyncTimers = new Map();
  /** @type {Map<string, Promise<void>>} serialize read-modify-write per conversation */
  const conversationPersistChains = new Map();

  function accountLabelForSlot(slotKeyId, waClient, accountId) {
    const entryNow = slots.get(slotKeyId);
    return (
      channelLabelFromClient(waClient) ||
      (entryNow && entryNow.pushname) ||
      (entryNow && entryNow.phone) ||
      `WhatsApp ${accountId}`
    );
  }

  function scheduleDebouncedChatSync(workspaceUserId, accountId, jid, peerPhone = "") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const peerJid = typeof jid === "string" ? jid.trim() : "";
    if (!safe || !peerJid) return;
    const debounceKey = `${slotKey(safe, safeAccountId)}::${peerJid}`;
    const existing = pendingChatSyncTimers.get(debounceKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingChatSyncTimers.delete(debounceKey);
      void syncSingleChatForJid(safe, safeAccountId, peerJid, peerPhone);
    }, CHAT_SYNC_DEBOUNCE_MS);
    pendingChatSyncTimers.set(debounceKey, timer);
    if (typeof timer.unref === "function") timer.unref();
  }

  async function syncSingleChatForJid(workspaceUserId, accountId, jid, peerPhone = "") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const peerJid = typeof jid === "string" ? jid.trim() : "";
    if (!safe || !peerJid || isNonPersonalWhatsAppJid(peerJid)) return;

    const key = slotKey(safe, safeAccountId);
    const entry = slots.get(key);
    if (!entry?.client || entry.phase !== "ready") return;

    let resolvedPhone =
      typeof peerPhone === "string" ? peerPhone.trim() : "";
    if (!resolvedPhone) {
      const conversationId = jidToConversationId(peerJid);
      const session = getTestChatSessionByConversation(safe, conversationId);
      resolvedPhone =
        typeof session?.whatsappPeerPhone === "string" ? session.whatsappPeerPhone.trim() : "";
    }

    try {
      await recoverClientPage(entry.client);
      const chat = await resolveChatForPeerJid(entry.client, peerJid, resolvedPhone);
      if (!chat) {
        waLog(safe, safeAccountId, `single-chat sync skipped (chat unavailable for ${peerJid})`);
        return;
      }
      const label =
        channelLabelFromClient(entry.client) ||
        entry.pushname ||
        entry.phone ||
        `WhatsApp ${safeAccountId}`;
      await syncSingleChatToSession(entry.client, safe, safeAccountId, chat, label);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isTransientPuppeteerFrameError(e) || isProtocolTimeoutError(e)) {
        waLog(safe, safeAccountId, "single-chat sync skipped (transient)", msg.slice(0, 120));
        return;
      }
      waLog(safe, safeAccountId, "single-chat sync failed", msg.slice(0, 120));
    }
  }

  function scheduleDebouncedAccountSync(workspaceUserId, accountId) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    const debounceKey = slotKey(safe, safeAccountId);
    const existing = pendingAccountSyncTimers.get(debounceKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingAccountSyncTimers.delete(debounceKey);
      void syncConversationsForAccount(safe, safeAccountId).catch((e) => {
        waLog(
          safe,
          safeAccountId,
          "debounced conversation sync failed",
          e instanceof Error ? e.message : String(e)
        );
      });
    }, ACCOUNT_SYNC_DEBOUNCE_MS);
    pendingAccountSyncTimers.set(debounceKey, timer);
    if (typeof timer.unref === "function") timer.unref();
  }

  async function patchInboundMessageAttachments(
    workspaceUserId,
    conversationId,
    sessionOpts,
    attachments
  ) {
    if (!Array.isArray(attachments) || !attachments.length) return;
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    if (!safe) return;
    const refreshed = getTestChatSessionByConversation(safe, conversationId);
    if (!refreshed?.messages?.length) return;
    const patched = [...refreshed.messages];
    for (let i = patched.length - 1; i >= 0; i -= 1) {
      if (patched[i]?.role === "user") {
        patched[i] = { ...patched[i], attachments };
        break;
      }
    }
    saveTestChatSession(safe, conversationId, patched, {
      ...sessionOpts,
      liveAgentEnabled: Boolean(refreshed.liveAgentEnabled),
    });
  }

  /**
   * Persist an inbound personal-chat message immediately (before slow contact lookups).
   * Safe to call from both `message_create` and `message` — dedupes via appendUniqueSessionMessages.
   */
  async function persistInboundWhatsAppMessage(workspaceUserId, accountId, slotKeyId, waClient, msg) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const jid = peerJidFromWhatsAppMessage(msg);
    if (!jid || isNonPersonalWhatsAppJid(jid)) return null;

    const conversationId = jidToConversationId(jid);
    const incomingRecord = await whatsappMessageToRecord(msg, sanitizeMessageAttachments, waClient, {
      skipMedia: true,
    });
    if (!incomingRecord) return null;

    const existing = getTestChatSessionByConversation(safe, conversationId);
    const label = accountLabelForSlot(slotKeyId, waClient, safeAccountId);
    const existingPeerPhone =
      typeof existing?.whatsappPeerPhone === "string" ? existing.whatsappPeerPhone.trim() : "";
    const sessionOpts = {
      chatSource: "whatsapp",
      channelAccountName: label,
      whatsappChatId: jid,
      whatsappPeerPhone: existingPeerPhone,
      whatsappAccountId: safeAccountId,
      liveAgentEnabled: Boolean(existing?.liveAgentEnabled),
    };

    const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
    const persistedMessages = appendUniqueSessionMessages(existingMessages, [incomingRecord]);
    const wasDuplicate = persistedMessages.length === existingMessages.length;

    if (!wasDuplicate) {
      saveTestChatSession(safe, conversationId, persistedMessages, sessionOpts);
      // Backfill older history for brand-new chats only — live message is already saved above.
      if (!existing || existingMessages.length === 0) {
        scheduleDebouncedChatSync(safe, safeAccountId, jid, existingPeerPhone);
      }
      waLog(safe, safeAccountId, `saved inbound message (${conversationId})`);
    }

    if (!existingPeerPhone) {
      void resolvePeerWhatsappPhone(waClient, msg)
        .then((phone) => {
          if (!phone) return;
          const latest = getTestChatSessionByConversation(safe, conversationId);
          if (!latest) return;
          saveTestChatSession(safe, conversationId, latest.messages, {
            ...sessionOpts,
            whatsappPeerPhone: phone,
            liveAgentEnabled: Boolean(latest.liveAgentEnabled),
          });
        })
        .catch(() => {});
    }

    if (msg?.hasMedia) {
      void whatsappMessageToRecord(msg, sanitizeMessageAttachments, waClient)
        .then((withMedia) => {
          const att = Array.isArray(withMedia?.attachments) ? withMedia.attachments : [];
          if (!att.length) return;
          return patchInboundMessageAttachments(safe, conversationId, sessionOpts, att);
        })
        .catch(() => {});
    }

    return {
      conversationId,
      incomingRecord,
      persistedMessages,
      sessionOpts,
      wasDuplicate,
      jid,
    };
  }

  async function persistOutboundWhatsAppMessage(workspaceUserId, accountId, slotKeyId, waClient, msg) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const jid = peerJidFromWhatsAppMessage(msg);
    if (!jid || isNonPersonalWhatsAppJid(jid)) return;

    try {
      const chat = await msg.getChat();
      if (isNonPersonalWhatsAppChat(chat)) return;
    } catch {
      /* ignore */
    }

    const conversationId = jidToConversationId(jid);
    const outboundRecord = await whatsappMessageToRecord(msg, sanitizeMessageAttachments, waClient, {
      skipMedia: true,
    });
    if (!outboundRecord) return;

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

    const label = accountLabelForSlot(slotKeyId, waClient, safeAccountId);
    const nextMessages = appendUniqueSessionMessages(existingMessages, [outboundRecord]);
    const existingPeerPhone =
      typeof existing?.whatsappPeerPhone === "string" ? existing.whatsappPeerPhone.trim() : "";

    saveTestChatSession(safe, conversationId, nextMessages, {
      chatSource: "whatsapp",
      channelAccountName: label,
      whatsappChatId: jid,
      whatsappPeerPhone: existingPeerPhone,
      whatsappAccountId: safeAccountId,
      liveAgentEnabled: Boolean(existing?.liveAgentEnabled),
    });
    scheduleDebouncedAccountSync(safe, safeAccountId);

    if (!existingPeerPhone) {
      void resolvePeerPhoneFromJid(waClient, jid, msg)
        .then((phone) => {
          if (!phone) return;
          const latest = getTestChatSessionByConversation(safe, conversationId);
          if (!latest) return;
          saveTestChatSession(safe, conversationId, latest.messages, {
            chatSource: "whatsapp",
            channelAccountName: label,
            whatsappChatId: jid,
            whatsappPeerPhone: phone,
            whatsappAccountId: safeAccountId,
            liveAgentEnabled: Boolean(latest.liveAgentEnabled),
          });
        })
        .catch(() => {});
    }

    if (msg?.hasMedia) {
      void whatsappMessageToRecord(msg, sanitizeMessageAttachments, waClient)
        .then((withMedia) => {
          const att = Array.isArray(withMedia?.attachments) ? withMedia.attachments : [];
          if (!att.length) return;
          const refreshed = getTestChatSessionByConversation(safe, conversationId);
          if (!refreshed?.messages?.length) return;
          const patched = [...refreshed.messages];
          for (let i = patched.length - 1; i >= 0; i -= 1) {
            if (patched[i]?.role === "main_account") {
              patched[i] = { ...patched[i], attachments: att };
              break;
            }
          }
          saveTestChatSession(safe, conversationId, patched, {
            chatSource: "whatsapp",
            channelAccountName: label,
            whatsappChatId: jid,
            whatsappPeerPhone: existingPeerPhone,
            whatsappAccountId: safeAccountId,
            liveAgentEnabled: Boolean(refreshed.liveAgentEnabled),
          });
        })
        .catch(() => {});
    }
  }

  async function handleInboundWhatsAppAiReply(workspaceUserId, accountId, slotKeyId, waClient, msg) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const jid = peerJidFromWhatsAppMessage(msg);
    if (!jid || isNonPersonalWhatsAppJid(jid)) return;

    const conversationId = jidToConversationId(jid);
    const chainKey = `${safe}::${conversationId}`;
    const pendingPersist = conversationPersistChains.get(chainKey);
    if (pendingPersist) {
      await pendingPersist.catch(() => {});
    }

    const existing = getTestChatSessionByConversation(safe, conversationId);
    if (!existing?.messages?.length) return;

    const incomingRecord = await whatsappMessageToRecord(msg, sanitizeMessageAttachments, waClient, {
      skipMedia: true,
    });
    if (!incomingRecord) return;

    const label = accountLabelForSlot(slotKeyId, waClient, safeAccountId);
    const sessionOpts = {
      chatSource: "whatsapp",
      channelAccountName: label,
      whatsappChatId: jid,
      whatsappPeerPhone:
        typeof existing.whatsappPeerPhone === "string" ? existing.whatsappPeerPhone.trim() : "",
      whatsappAccountId: safeAccountId,
      liveAgentEnabled: Boolean(existing.liveAgentEnabled),
    };
    const persistedMessages = Array.isArray(existing.messages) ? existing.messages : [];

    if (isStaleWhatsAppMessage(msg)) {
      waLog(
        safe,
        safeAccountId,
        `skipped auto-reply for stale message (${Math.round(getWhatsAppMessageAgeMs(msg) / 1000)}s old)`
      );
      return;
    }

    if (!incomingRecord.content) return;

    const priorForAi = priorMessagesFromSession({ messages: persistedMessages })
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "main_account")
      .map((m) => (m.role === "main_account" ? { ...m, role: "assistant" } : m));

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
      skipUserPersist: true,
      ...sessionOpts,
    });

    if (Array.isArray(incomingRecord.attachments) && incomingRecord.attachments.length) {
      await patchInboundMessageAttachments(safe, conversationId, sessionOpts, incomingRecord.attachments);
    }

    if (result.kind === "success" && typeof result.reply === "string" && result.reply.trim()) {
      await deliverAssistantText(waClient, msg, result.reply);
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
      await deliverAssistantText(waClient, msg, fallbackCopy);
    }
  }

  function runSerializedConversationPersist(workspaceUserId, conversationId, task) {
    const chainKey = `${workspaceUserId}::${conversationId}`;
    const prev = conversationPersistChains.get(chainKey) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => task());
    conversationPersistChains.set(chainKey, next);
    void next.finally(() => {
      if (conversationPersistChains.get(chainKey) === next) {
        conversationPersistChains.delete(chainKey);
      }
    });
    return next;
  }

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
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        waLog(safe, safeAccountId, "removed persisted auth session files");
      }
      // Legacy per-account web caches (shared cache is kept for faster relink).
      const userDir = path.join(dataRoot, safe);
      const legacyCaches = [
        path.join(userDir, ".wwebjs_cache"),
        path.join(userDir, `.wwebjs_cache-${clientId === "wa" ? "wa" : clientId}`),
      ];
      for (const legacyCache of legacyCaches) {
        if (!fs.existsSync(legacyCache)) continue;
        try {
          fs.rmSync(legacyCache, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
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

  function clearReadyWatchdog(entry) {
    if (!entry?.readyWatchdogTimer) return;
    clearTimeout(entry.readyWatchdogTimer);
    entry.readyWatchdogTimer = null;
  }

  function stopConnectionProbe(entry) {
    if (!entry?.connectionProbeTimer) return;
    clearInterval(entry.connectionProbeTimer);
    entry.connectionProbeTimer = null;
  }

  function finalizeEntryReady(entry, client, workspaceUserId, accountId, key, linkOptions = {}) {
    if (!entry || entry.phase === "ready") return;
    clearReadyWatchdog(entry);
    stopConnectionProbe(entry);
    setEntryPhase(entry, "ready");
    entry.qrDataUrl = "";
    const wid = client?.info?.wid;
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
    whatsappAutoStart.addLink(workspaceUserId, accountId);
    startPageKeepAlive(entry, workspaceUserId, accountId);
    if (entry.linkIntent === "user_qr" && typeof onAccountLinkedViaQr === "function") {
      onAccountLinkedViaQr(workspaceUserId, accountId, {
        pushname: entry.pushname,
        phone: entry.phone,
        label: `Account ${accountId}`,
      });
    }
    entry.linkIntent = "auto_restore";
    if (client) {
      void profilePicDataUrlFromClient(client).then((dataUrl) => {
        entry.profilePicDataUrl = typeof dataUrl === "string" ? dataUrl : "";
      });
    }
    waLog(
      workspaceUserId,
      accountId,
      `linked and ready (account=${entry.pushname || "unknown"}${entry.phone ? ` · ${entry.phone}` : ""})`
    );
    if (!bulkRestoreInProgress && !linkOptions.deferConversationSync) {
      setTimeout(() => {
        void syncConversationsForAccount(workspaceUserId, accountId).catch((e) => {
          waLog(
            workspaceUserId,
            accountId,
            "auto conversation sync failed",
            e instanceof Error ? e.message : String(e)
          );
        });
      }, 8000);
    }
  }

  async function probeEntryConnection(entry, client, workspaceUserId, accountId, key, linkOptions) {
    if (!entry || entry.phase === "ready" || !client) return false;
    if (!["authenticated", "initializing"].includes(entry.phase)) return false;
    try {
      if (client.info?.wid?.user) {
        finalizeEntryReady(entry, client, workspaceUserId, accountId, key, linkOptions);
        return true;
      }
      if (typeof client.getState === "function") {
        const state = await client.getState();
        if (state === "CONNECTED") {
          finalizeEntryReady(entry, client, workspaceUserId, accountId, key, linkOptions);
          return true;
        }
      }
    } catch {
      /* ignore transient probe errors */
    }
    return false;
  }

  function startConnectionProbe(entry, client, workspaceUserId, accountId, key, linkOptions) {
    stopConnectionProbe(entry);
    if (!entry || !client) return;
    entry.connectionProbeTimer = setInterval(() => {
      void probeEntryConnection(entry, client, workspaceUserId, accountId, key, linkOptions);
    }, CONNECTION_PROBE_INTERVAL_MS);
    if (typeof entry.connectionProbeTimer.unref === "function") {
      entry.connectionProbeTimer.unref();
    }
    void probeEntryConnection(entry, client, workspaceUserId, accountId, key, linkOptions);
  }

  function startReadyWatchdog(entry, workspaceUserId, accountId) {
    if (!entry) return;
    clearReadyWatchdog(entry);
    entry.readyWatchdogTimer = setTimeout(() => {
      void (async () => {
        if (!entry || entry.phase === "ready") return;
        if (!["authenticated", "initializing"].includes(entry.phase)) return;
        const webCachePath = resolveUserWebCacheDir(workspaceUserId, accountId);
        waLog(
          workspaceUserId,
          accountId,
          "ready watchdog: stuck after auth — refreshing web cache and retrying"
        );
        clearReadyWatchdog(entry);
        sanitizeWebCacheDir(webCachePath, WHATSAPP_WEB_VERSION);
        try {
          await ensurePinnedWebVersionHtml(webCachePath, WHATSAPP_WEB_VERSION);
        } catch (e) {
          waLog(
            workspaceUserId,
            accountId,
            "ready watchdog: web cache refresh failed",
            e instanceof Error ? e.message : String(e)
          );
        }
        await destroyClient(workspaceUserId, accountId);
        void ensureConnected(workspaceUserId, accountId, { force: true });
      })();
    }, READY_AFTER_AUTH_TIMEOUT_MS);
    if (typeof entry.readyWatchdogTimer.unref === "function") {
      entry.readyWatchdogTimer.unref();
    }
  }

  async function destroyClient(workspaceUserId, accountId = "1") {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return;
    const key = slotKey(safe, safeAccountId);
    waLog(safe, safeAccountId, "destroying client session");
    const entry = slots.get(key);
    clearReadyWatchdog(entry);
    stopConnectionProbe(entry);
    stopPageKeepAlive(entry);
    let profileDir = "";
    let browserPid = 0;
    if (entry?.client) {
      browserPid = readClientBrowserPid(entry.client);
      try {
        entry.client.removeAllListeners();
        await entry.client.destroy();
      } catch {
        /* ignore */
      }
      unregisterProtectedBrowserPid(browserPid);
      // Allow Chrome to flush LocalAuth / IndexedDB to disk before profile cleanup.
      await sleepMs(800);
      try {
        const authRoot = resolveUserAuthRoot(safe);
        const localAuthClientId = localAuthClientIdForAccount(safeAccountId);
        profileDir = path.join(authRoot, `session-${localAuthClientId}`);
      } catch {
        /* ignore */
      }
    }
    slots.delete(key);
    if (profileDir) releaseStaleBrowserProfileDir(profileDir);
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
    const now = Date.now();
    if (!entry.frameGlitchWindowStart || now - entry.frameGlitchWindowStart > FRAME_GLITCH_WINDOW_MS) {
      entry.frameGlitchWindowStart = now;
      entry.frameGlitchCount = 0;
    }
    entry.frameGlitchCount = Number(entry.frameGlitchCount) || 0;
    entry.frameGlitchCount += 1;
    if (entry.frameGlitchCount < FRAME_GLITCH_RECONNECT_THRESHOLD) {
      waLog(
        workspaceUserId,
        accountId,
        `transient glitch (${entry.frameGlitchCount}/${FRAME_GLITCH_RECONNECT_THRESHOLD}): ${String(reason).slice(0, 80)}`
      );
      return;
    }
    entry.frameGlitchCount = 0;
    entry.frameGlitchWindowStart = 0;
    waLog(workspaceUserId, accountId, `connection unhealthy (${reason}); scheduling reconnect`);
    setEntryPhase(entry, "disconnected");
    entry.error = reason;
    stopPageKeepAlive(entry);
    scheduleReconnect(workspaceUserId, accountId, reason);
  }

  function clearFrameGlitch(entry) {
    if (!entry) return;
    entry.frameGlitchCount = 0;
    entry.frameGlitchWindowStart = 0;
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
          .then(() => {
            clearFrameGlitch(entry);
          })
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
    let entry = slots.get(key);
    if (entry?.phase === "ready") {
      clearReconnectState(key);
      return;
    }
    if (entry?.phase === "qr") {
      // Auto-restore landed on QR — session needs a manual rescan, not another Chrome launch.
      if (entry.linkIntent !== "user_qr") return;
    }
    if (
      entry &&
      ["initializing", "qr", "authenticated"].includes(entry.phase)
    ) {
      const stuckMs = phaseAgeMs(entry, Date.now());
      if (force && stuckMs >= 8000) {
        waLog(
          safe,
          safeAccountId,
          `force: restarting stuck ${entry.phase} session (${stuckMs}ms)`
        );
        await destroyClient(safe, safeAccountId);
        entry = null;
      } else {
        return;
      }
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
        needsQrRelink: false,
        phaseSince: null,
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
      needsQrRelink: Boolean(
        persisted && entry.phase === "qr" && entry.linkIntent !== "user_qr"
      ),
      phaseSince: Number.isFinite(Number(entry.phaseSince)) ? Number(entry.phaseSince) : null,
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
      if (!bulkRestoreInProgress) {
        const staleAutoRestoreQr =
          slotEntry?.phase === "qr" && slotEntry.linkIntent !== "user_qr";
        if (
          persisted &&
          !staleAutoRestoreQr &&
          (!slotEntry || slotEntry.phase !== "ready") &&
          !reconnecting.has(key)
        ) {
          void ensureConnected(safe, accountId);
        } else if (
          !staleAutoRestoreQr &&
          slotNeedsAutoReconnect(safe, accountId, slotEntry) &&
          !reconnecting.has(key)
        ) {
          void ensureConnected(safe, accountId);
        }
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
    if (isNonPersonalWhatsAppChat(chat)) return { action: "skipped", reason: "non_personal" };

    const jid = chatJidFromChat(chat);
    if (!jid) return { action: "skipped", reason: "no_jid" };
    if (isNonPersonalWhatsAppJid(jid)) return { action: "skipped", reason: "non_personal" };

    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const conversationId = jidToConversationId(jid);

    let waMessages = [];
    try {
      const fetchLimit =
        WHATSAPP_SYNC_MESSAGE_LIMIT > 0 ? WHATSAPP_SYNC_MESSAGE_LIMIT : Infinity;
      const fetched = await chat.fetchMessages({ limit: fetchLimit });
      const sorted = (Array.isArray(fetched) ? fetched : []).sort(
        (a, b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0)
      );
      const records = await Promise.all(
        sorted.map((msg) => whatsappMessageToRecord(msg, sanitizeMessageAttachments, client))
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
        chats = await fetchClientChatsWithRetry(client);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        waLog(safe, safeAccountId, "sync getChats failed", msg);
        return { ok: false, accountId: safeAccountId, message: msg };
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      // Personal chats only — never fetch or store group / channel / status messages.
      const personalChats = (Array.isArray(chats) ? chats : []).filter(
        (chat) => !isNonPersonalWhatsAppChat(chat)
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

  async function resolveReadyClientForAccount(workspaceUserId, accountId) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    if (!safe) return null;
    const primaryKey = slotKey(safe, safeAccountId);
    const primary = slots.get(primaryKey);
    if (primary?.client && primary.phase === "ready") {
      return { client: primary.client, accountId: safeAccountId };
    }
    for (const [slotId, slotEntry] of slots.entries()) {
      if (!slotId.startsWith(`${safe}::`)) continue;
      if (!slotEntry?.client || slotEntry.phase !== "ready") continue;
      return { client: slotEntry.client, accountId: slotId.split("::")[1] || safeAccountId };
    }
    return null;
  }

  async function editWhatsAppMessage(workspaceUserId, accountId, messageId, content) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const waMessageId = typeof messageId === "string" ? messageId.trim() : "";
    const body = typeof content === "string" ? content.trim() : "";
    if (!safe || !waMessageId || !body) {
      return { ok: false, message: "Missing user, WhatsApp message id, or new text" };
    }
    const resolved = await resolveReadyClientForAccount(safe, safeAccountId);
    if (!resolved?.client) {
      return { ok: false, message: "WhatsApp is not connected for this account" };
    }
    try {
      const msg = await resolved.client.getMessageById(waMessageId);
      if (!msg) {
        return { ok: false, message: "Message not found on WhatsApp" };
      }
      const edited = await msg.edit(body);
      if (!edited) {
        return {
          ok: false,
          message:
            "WhatsApp could not edit this message (it may be too old or not editable on WhatsApp).",
        };
      }
      return { ok: true, messageId: waMessageId };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "WhatsApp edit failed",
      };
    }
  }

  async function deleteWhatsAppMessage(workspaceUserId, accountId, messageId, options = {}) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const safeAccountId = sanitizeWhatsAppAccountId(accountId) || "1";
    const waMessageId = typeof messageId === "string" ? messageId.trim() : "";
    const everyone = options.everyone !== false;
    if (!safe || !waMessageId) {
      return { ok: false, message: "Missing user or WhatsApp message id" };
    }
    const resolved = await resolveReadyClientForAccount(safe, safeAccountId);
    if (!resolved?.client) {
      return { ok: false, message: "WhatsApp is not connected for this account" };
    }
    try {
      const msg = await resolved.client.getMessageById(waMessageId);
      if (!msg) {
        return { ok: false, message: "Message not found on WhatsApp" };
      }
      await msg.delete(everyone);
      return { ok: true, messageId: waMessageId };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "WhatsApp delete failed",
      };
    }
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
    releaseStaleBrowserProfileDir(localAuthProfileDir);

    sanitizeWebCacheDir(webCachePath, WHATSAPP_WEB_VERSION);
    try {
      await ensurePinnedWebVersionHtml(webCachePath, WHATSAPP_WEB_VERSION);
      waLog(safe, safeAccountId, `using pinned WhatsApp Web version ${WHATSAPP_WEB_VERSION}`);
    } catch (e) {
      waLog(
        safe,
        safeAccountId,
        "could not prefetch pinned WhatsApp Web HTML",
        e instanceof Error ? e.message : String(e)
      );
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: localAuthClientId,
        dataPath: authRoot,
      }),
      authTimeoutMs: 120000,
      // Prefer this server session, but give a brief window so a second Web client
      // does not thrash the link into a disconnect loop.
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10000,
      webVersion: WHATSAPP_WEB_VERSION,
      webVersionCache: {
        type: "local",
        path: webCachePath,
        strict: true,
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
      startReadyWatchdog(entry, safe, safeAccountId);
      startConnectionProbe(entry, client, safe, safeAccountId, key, options);
      waLog(safe, safeAccountId, "account login authenticated");
    });

    client.on("loading_screen", (percent) => {
      const pct = Number(percent);
      if (Number.isFinite(pct) && pct >= 99 && ["authenticated", "initializing"].includes(entry.phase)) {
        startReadyWatchdog(entry, safe, safeAccountId);
        void probeEntryConnection(entry, client, safe, safeAccountId, key, options);
      }
    });

    client.on("auth_failure", (m) => {
      setEntryPhase(entry, "error");
      entry.error = String(m || "auth_failure");
      waLog(safe, safeAccountId, "auth failure", entry.error);
    });

    client.on("ready", () => {
      finalizeEntryReady(entry, client, safe, safeAccountId, key, options);
    });

    client.on("change_state", (state) => {
      const normalized = String(state || "").toUpperCase();
      if (!normalized) return;
      waLog(safe, safeAccountId, "change_state", normalized);
      if (normalized === "CONNECTED") {
        finalizeEntryReady(entry, client, safe, safeAccountId, key, options);
        clearReconnectState(key);
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
     * Persist every created message (inbound + outbound). The `message` event does not fire for
     * outbound phone/desktop sends; inbound is persisted here first so slow contact lookups never
     * block saving new contacts.
     */
    client.on("message_create", async (msg) => {
      if (isIgnoredWhatsAppMessage(msg)) return;
      const jid = peerJidFromWhatsAppMessage(msg);
      if (!jid || isNonPersonalWhatsAppJid(jid)) return;

      const conversationId = jidToConversationId(jid);
      void runSerializedConversationPersist(safe, conversationId, async () => {
        try {
          if (msg.fromMe) {
            await persistOutboundWhatsAppMessage(safe, safeAccountId, key, client, msg);
          } else {
            await persistInboundWhatsAppMessage(safe, safeAccountId, key, client, msg);
          }
        } catch (e) {
          waLog(
            safe,
            safeAccountId,
            msg.fromMe ? "failed syncing outbound WhatsApp message" : "failed saving inbound WhatsApp message",
            e instanceof Error ? e.message : String(e)
          );
        }
      });
    });

    client.on("message", async (msg) => {
      if (msg.fromMe) return;
      if (isIgnoredWhatsAppMessage(msg)) return;

      const jid = peerJidFromWhatsAppMessage(msg);
      if (!jid || isNonPersonalWhatsAppJid(jid)) return;

      void handleInboundWhatsAppAiReply(safe, safeAccountId, key, client, msg).catch((e) => {
        waLog(
          safe,
          safeAccountId,
          "inbound AI handling failed",
          e instanceof Error ? e.message : String(e)
        );
      });
    });

    const initializeClient = async () => {
      await client.initialize();
      const browserPid = readClientBrowserPid(client);
      if (browserPid) registerProtectedBrowserPid(browserPid);
      waLog(safe, safeAccountId, "client initialize() called successfully");
      startReadyWatchdog(entry, safe, safeAccountId);
      startConnectionProbe(entry, client, safe, safeAccountId, key, options);
    };

    try {
      await initializeClient();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isBrowserAlreadyRunningError(message)) {
        waLog(
          safe,
          safeAccountId,
          "browser profile still locked — releasing stale Chrome and retrying once"
        );
        releaseStaleBrowserProfileDir(localAuthProfileDir);
        await sleepMs(500);
        try {
          await initializeClient();
          return { ok: true };
        } catch (retryErr) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          setEntryPhase(entry, "error");
          entry.error = formatBrowserLaunchHelp(
            "Failed to launch browser for WhatsApp Web. " + retryMessage
          );
          waLog(safe, safeAccountId, "initialize failed after profile cleanup", entry.error);
          return { ok: false, error: entry.error };
        }
      }
      setEntryPhase(entry, "error");
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const entry = slots.get(key);
    return {
      ok: false,
      phase: entry?.phase || "timeout",
      error: "Timed out waiting for WhatsApp connection",
    };
  }

  /**
   * Reconnect persisted LocalAuth sessions after server boot.
   * Restores accounts in parallel (bounded concurrency) instead of one-by-one.
   */
  async function restorePersistedConnections(links = null, options = {}) {
    const toRestore = Array.isArray(links) ? links : whatsappAutoStart.readRestoreLinks();
    const envConcurrency = Number(process.env.WHATSAPP_RESTORE_CONCURRENCY);
    const concurrency =
      Number(options.concurrency) > 0
        ? Number(options.concurrency)
        : Number.isFinite(envConcurrency) && envConcurrency > 0
          ? envConcurrency
          : 2;
    const readyTimeoutMs =
      Number(options.readyTimeoutMs) > 0 ? Number(options.readyTimeoutMs) : 180000;
    const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 3;
    const bootRestore = options.boot === true;
    const retryDelayMs =
      Number(options.retryDelayMs) > 0
        ? Number(options.retryDelayMs)
        : bootRestore
          ? 500
          : 2000;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    await warmupForRestore();

    if (!toRestore.length) return [];

    bulkRestoreInProgress = true;
    const results = new Array(toRestore.length);
    let nextIndex = 0;

    async function restoreOneLink(link) {
      const uid = sanitizeAgentDetailsUserId(String(link.userId || "").trim());
      const accountId = sanitizeWhatsAppAccountId(link.accountId) || "1";
      if (!uid) return { userId: "", accountId, ok: false, reason: "invalid_user" };

      if (!hasPersistedAccountSession(uid, accountId)) {
        waLog(uid, accountId, "skip restore: no persisted session on disk");
        return { userId: uid, accountId, ok: false, reason: "no_session" };
      }

      let restored = false;
      let lastReason = "";

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          waLog(uid, accountId, `restore attempt ${attempt}/${maxAttempts}`);
          releaseStaleBrowserProfileDir(resolveAccountSessionDir(uid, accountId));
          const startResult = await startLinking(uid, accountId, {
            deferConversationSync: true,
          });
          if (!startResult?.ok) {
            lastReason = startResult?.error || "initialize_failed";
            if (attempt < maxAttempts) {
              await sleep(retryDelayMs * attempt);
              continue;
            }
            break;
          }

          if (startResult.alreadyConnected) {
            restored = true;
            break;
          }

          const wait = await waitForSlotPhase(
            uid,
            accountId,
            ["ready", "authenticated"],
            readyTimeoutMs
          );
          if (wait.ok && wait.phase === "ready") {
            restored = true;
            break;
          }
          if (wait.ok && wait.phase === "authenticated") {
            const readyWait = await waitForSlotPhase(uid, accountId, ["ready"], 90000);
            if (readyWait.ok && readyWait.phase === "ready") {
              restored = true;
              break;
            }
          }

          const phaseNow = slots.get(slotKey(uid, accountId))?.phase || wait.phase;
          if (phaseNow === "qr") {
            lastReason = "needs_qr_rescan";
            const qrEntry = slots.get(slotKey(uid, accountId));
            if (qrEntry) {
              // Keep the live QR client — user can scan from Integrations without wiping auth files.
              qrEntry.linkIntent = "user_qr";
            }
            break;
          }
          lastReason = wait.error || phaseNow || "not_ready";
        } catch (e) {
          lastReason = e instanceof Error ? e.message : String(e);
        }

        if (attempt < maxAttempts) {
          await destroyClient(uid, accountId);
          const delayMs = retryDelayMs * attempt;
          waLog(uid, accountId, `restore retry in ${delayMs}ms`, lastReason);
          await sleep(delayMs);
        }
      }

      if (restored) {
        failedReconnectCounts.delete(slotKey(uid, accountId));
        waLog(uid, accountId, "persisted session restored");
        return { userId: uid, accountId, ok: true };
      }

      waLog(uid, accountId, "restore failed", lastReason || "unknown");
      const isAuthFailure = /auth.?fail/i.test(lastReason);
      if (isAuthFailure) {
        await destroyClient(uid, accountId);
        removeAuthSession(uid, accountId);
        whatsappAutoStart.removeLink(uid, accountId);
        failedReconnectCounts.delete(slotKey(uid, accountId));
        waLog(uid, accountId, "cleared invalid session (reason: " + lastReason + ")");
      }
      return { userId: uid, accountId, ok: false, reason: lastReason || "unknown" };
    }

    async function restoreWorker() {
      while (nextIndex < toRestore.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await restoreOneLink(toRestore[index]);
      }
    }

    const workerCount = Math.min(Math.max(1, concurrency), toRestore.length);
    waLog(
      "system",
      "restore",
      `restoring ${toRestore.length} session(s) with concurrency=${workerCount}`
    );

    try {
      await Promise.all(Array.from({ length: workerCount }, () => restoreWorker()));
    } finally {
      bulkRestoreInProgress = false;
    }

    const restoredAccounts = results.filter((r) => r?.ok);
    restoredAccounts.forEach((r, index) => {
      // Stagger post-restore sync so multiple Chrome instances do not call getChats() at once.
      const syncDelayMs = bootRestore ? 15000 + index * 15000 : 4000 + index * 2000;
      setTimeout(() => {
        void syncConversationsForAccount(r.userId, r.accountId).catch((e) => {
          waLog(
            r.userId,
            r.accountId,
            "post-restore conversation sync failed",
            e instanceof Error ? e.message : String(e)
          );
        });
      }, syncDelayMs);
    });

    return results.filter(Boolean);
  }

  let warmupPromise = null;

  async function warmupForRestore() {
    if (!warmupPromise) {
      warmupPromise = (async () => {
        releaseAllPersistedBrowserProfiles();
        const webCachePath = resolveSharedWebCacheDir();
        resolveChromeExecutablePath();
        sanitizeWebCacheDir(webCachePath, WHATSAPP_WEB_VERSION);
        try {
          await ensurePinnedWebVersionHtml(webCachePath, WHATSAPP_WEB_VERSION);
          waLog("system", "warmup", `pinned WhatsApp Web ${WHATSAPP_WEB_VERSION} ready`);
        } catch (e) {
          waLog(
            "system",
            "warmup",
            "could not prefetch pinned WhatsApp Web HTML",
            e instanceof Error ? e.message : String(e)
          );
        }
      })();
    }
    return warmupPromise;
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
    if (bulkRestoreInProgress) return;
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
        // Auto-restore QR means the saved session is invalid — do not relaunch Chrome in a loop.
        waLog(
          uid,
          accountId,
          "watchdog: auto-restore requires QR rescan (session stale); waiting for manual relink"
        );
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

  function startPeriodicConversationSyncLoop() {
    let syncIndex = 0;
    const timer = setInterval(() => {
      if (bulkRestoreInProgress) return;
      const readySlots = [];
      for (const [key, entry] of slots.entries()) {
        if (!entry?.client || entry.phase !== "ready") continue;
        const parts = String(key).split("::");
        if (parts.length !== 2) continue;
        readySlots.push({ userId: parts[0], accountId: parts[1], key });
      }
      if (!readySlots.length) return;
      const slot = readySlots[syncIndex % readySlots.length];
      syncIndex += 1;
      if (syncingConversations.has(slot.key)) return;
      void syncConversationsForAccount(slot.userId, slot.accountId).catch((e) => {
        waLog(
          slot.userId,
          slot.accountId,
          "periodic conversation sync failed",
          e instanceof Error ? e.message : String(e)
        );
      });
    }, PERIODIC_CONVERSATION_SYNC_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    waLog(
      "system",
      "sync",
      `periodic conversation sync started (every ${PERIODIC_CONVERSATION_SYNC_INTERVAL_MS / 1000}s, round-robin per account)`
    );
  }

  function startBackgroundReconnectLoop() {
    const timer = setInterval(() => {
      if (bulkRestoreInProgress) return;
      listPersistedAccountLinks().forEach((link) => {
        const uid = link.userId;
        const accountId = link.accountId;
        const key = slotKey(uid, accountId);
        const slotEntry = slots.get(key);
        if (slotEntry?.phase === "ready") return;
        if (slotEntry?.phase === "qr" && slotEntry.linkIntent !== "user_qr") return;
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
  startPeriodicConversationSyncLoop();

  return {
    startLinking,
    regenerateQr,
    ensureConnected,
    restorePersistedConnections,
    warmupForRestore,
    hasPersistedSession: hasPersistedAccountSession,
    destroyClient,
    disconnectAndForget,
    getStatus,
    sendText,
    editWhatsAppMessage,
    deleteWhatsAppMessage,
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
  isWhatsAppStatusJid,
  isWhatsAppChannelJid,
  isNonPersonalWhatsAppJid,
};
