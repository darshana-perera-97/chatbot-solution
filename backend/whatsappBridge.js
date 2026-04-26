const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const QRCode = require("qrcode");
const whatsappAutoStart = require("./whatsappAutoStart");

let Client;
let LocalAuth;
try {
  ({ Client, LocalAuth } = require("whatsapp-web.js"));
} catch {
  Client = null;
  LocalAuth = null;
}

const authRoot = path.join(__dirname, "data", "whatsapp-auth");

function ensureAuthDir() {
  if (!fs.existsSync(authRoot)) {
    fs.mkdirSync(authRoot, { recursive: true });
  }
}

function resolveChromeExecutablePath() {
  const fromEnv =
    (typeof process.env.PUPPETEER_EXECUTABLE_PATH === "string" &&
      process.env.PUPPETEER_EXECUTABLE_PATH.trim()) ||
    (typeof process.env.CHROME_BIN === "string" && process.env.CHROME_BIN.trim()) ||
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

/**
 * @param {object} deps
 * @param {function} deps.completeWorkspaceChatTurn
 * @param {function} deps.sanitizeAgentDetailsUserId
 * @param {function} deps.getTestChatSessionByConversation
 * @param {function} deps.sanitizeChatMessages
 */
function createWhatsAppBridge(deps) {
  const {
    completeWorkspaceChatTurn,
    sanitizeAgentDetailsUserId,
    getTestChatSessionByConversation,
    sanitizeChatMessages,
  } = deps;

  /** @type {Map<string, object>} */
  const slots = new Map();
  const waLog = (workspaceUserId, message, ...extra) => {
    const prefix = `[whatsapp][user:${workspaceUserId}]`;
    if (extra.length) {
      console.log(prefix, message, ...extra);
    } else {
      console.log(prefix, message);
    }
  };

  async function destroyClient(workspaceUserId) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    if (!safe) return;
    waLog(safe, "destroying client session");
    const entry = slots.get(safe);
    if (entry?.client) {
      try {
        entry.client.removeAllListeners();
        await entry.client.destroy();
      } catch {
        /* ignore */
      }
    }
    slots.delete(safe);
    waLog(safe, "client session removed");
  }

  function getStatus(workspaceUserId) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    if (!safe) {
      return { phase: "error", connected: false, available: Boolean(Client), error: "Invalid user id" };
    }
    const entry = slots.get(safe);
    if (!entry) {
      return {
        phase: "disconnected",
        connected: false,
        available: Boolean(Client),
        qrDataUrl: "",
        error: "",
        pushname: "",
        phone: "",
      };
    }
    return {
      phase: entry.phase,
      connected: entry.phase === "ready",
      available: Boolean(Client),
      qrDataUrl: entry.qrDataUrl || "",
      error: entry.error || "",
      pushname: entry.pushname || "",
      phone: entry.phone || "",
    };
  }

  async function sendText(workspaceUserId, peerJid, text) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    const body = typeof text === "string" ? text.trim() : "";
    const jid = typeof peerJid === "string" ? peerJid.trim() : "";
    if (!safe || !jid || !body) return { ok: false };
    const entry = slots.get(safe);
    if (!entry?.client || entry.phase !== "ready") return { ok: false };
    try {
      const sent = await entry.client.sendMessage(jid, body, { sendSeen: false });
      if (!sent) return { ok: false, message: "Message was not sent (chat unavailable?)" };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async function startLinking(workspaceUserId) {
    const safe = sanitizeAgentDetailsUserId(workspaceUserId);
    if (!safe) throw new Error("Invalid user id");
    if (!Client || !LocalAuth) {
      throw new Error("whatsapp-web.js is not installed. Run npm install in the backend folder.");
    }
    const existingSlot = slots.get(safe);
    if (existingSlot?.phase === "ready") {
      waLog(safe, "already linked and ready");
      return { ok: true, alreadyConnected: true };
    }
    if (
      existingSlot?.client &&
      ["initializing", "qr", "authenticated"].includes(existingSlot.phase)
    ) {
      waLog(safe, `linking already in progress (phase=${existingSlot.phase})`);
      return { ok: true, pending: true };
    }
    ensureAuthDir();
    waLog(safe, "starting linking flow (initializing client)");
    await destroyClient(safe);

    const entry = {
      phase: "initializing",
      qrDataUrl: "",
      error: "",
      pushname: "",
      phone: "",
      client: null,
    };
    slots.set(safe, entry);

    const executablePath = resolveChromeExecutablePath();
    if (!executablePath) {
      waLog(
        safe,
        "no browser executable detected (set PUPPETEER_EXECUTABLE_PATH for your server environment)"
      );
    } else {
      waLog(safe, `using browser executable: ${executablePath}`);
    }
    if (!executablePath) {
      entry.phase = "error";
      entry.error =
        "No Chrome/Chromium executable detected for WhatsApp Web. " +
        "Set PUPPETEER_EXECUTABLE_PATH (or CHROME_BIN) to your browser binary path.";
      waLog(safe, "initialize skipped", entry.error);
      return { ok: false, error: entry.error };
    }

    const localAuthClientId = `wa-${safe}`;
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
      puppeteer: buildPuppeteerOptions(executablePath),
    });

    entry.client = client;

    client.on("qr", async (qr) => {
      try {
        entry.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 });
        entry.phase = "qr";
        waLog(safe, "qr generated; waiting for device link scan");
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        entry.phase = "error";
        waLog(safe, "failed generating qr", entry.error);
      }
    });

    client.on("authenticated", () => {
      entry.phase = "authenticated";
      entry.qrDataUrl = "";
      waLog(safe, "account login authenticated");
    });

    client.on("auth_failure", (m) => {
      entry.phase = "error";
      entry.error = String(m || "auth_failure");
      waLog(safe, "auth failure", entry.error);
    });

    client.on("ready", () => {
      entry.phase = "ready";
      entry.qrDataUrl = "";
      const wid = client.info?.wid;
      entry.phone = wid?.user || "";
      entry.pushname = channelLabelFromClient(client);
      whatsappAutoStart.addUserId(safe);
      waLog(
        safe,
        `linked and ready (account=${entry.pushname || "unknown"}${entry.phone ? ` · ${entry.phone}` : ""})`
      );
    });

    client.on("disconnected", (reason) => {
      entry.phase = "disconnected";
      entry.error = String(reason || "disconnected");
      waLog(safe, "disconnected", entry.error);
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

      const entryNow = slots.get(safe);
      const label =
        channelLabelFromClient(client) ||
        (entryNow && entryNow.pushname) ||
        (entryNow && entryNow.phone) ||
        "WhatsApp";

      const existing = getTestChatSessionByConversation(safe, conversationId);
      const prior = (existing?.messages || [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
        }));
      const messages = sanitizeChatMessages([...prior, { role: "user", content: body }]);

      const result = await completeWorkspaceChatTurn({
        userId: safe,
        conversationId,
        messages,
        chatSource: "whatsapp",
        channelAccountName: label,
        whatsappChatId: jid,
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
      waLog(safe, "client initialize() called successfully");
    } catch (e) {
      entry.phase = "error";
      const message = e instanceof Error ? e.message : String(e);
      entry.error =
        "Failed to launch browser for WhatsApp Web. " +
        message +
        " | Tip: set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary path.";
      waLog(safe, "initialize failed", entry.error);
      return { ok: false, error: entry.error };
    }

    return { ok: true };
  }

  return {
    startLinking,
    destroyClient,
    getStatus,
    sendText,
    jidToConversationId,
    isLibraryAvailable: Boolean(Client),
  };
}

module.exports = {
  createWhatsAppBridge,
  jidToConversationId,
};
