const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "data", "whatsapp-autostart.json");
const DATA_ROOT = path.join(__dirname, "data");
const LEGACY_SESSION_FOLDER = "session-wa";

function ensureDir() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function linkKey(userId, accountId) {
  return `${String(userId || "").trim()}::${String(accountId || "1").trim()}`;
}

function parseLinkKey(key) {
  const parts = String(key || "").split("::");
  if (parts.length !== 2) return null;
  const userId = parts[0].trim();
  const accountId = parts[1].trim();
  if (!userId || !accountId) return null;
  return { userId, accountId };
}

function readLinksRaw() {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const links = [];
    if (Array.isArray(parsed.links)) {
      parsed.links.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        const userId = String(entry.userId || "").trim();
        const accountId = String(entry.accountId || "1").trim();
        if (userId && accountId) links.push({ userId, accountId });
      });
    }
    if (Array.isArray(parsed.userIds)) {
      parsed.userIds.forEach((id) => {
        const userId = String(id || "").trim();
        if (userId) links.push({ userId, accountId: "1" });
      });
    }
    const seen = new Set();
    return links.filter((link) => {
      const key = linkKey(link.userId, link.accountId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

function writeLinks(links) {
  ensureDir();
  const seen = new Set();
  const unique = [];
  links.forEach((link) => {
    const userId = String(link.userId || "").trim();
    const accountId = String(link.accountId || "1").trim();
    if (!userId || !accountId) return;
    const key = linkKey(userId, accountId);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push({ userId, accountId });
  });
  fs.writeFileSync(FILE_PATH, JSON.stringify({ links: unique }, null, 2), "utf8");
}

function addLink(userId, accountId = "1") {
  const safeUserId = String(userId || "").trim();
  const safeAccountId = String(accountId || "1").trim();
  if (!safeUserId || !safeAccountId) return;
  const links = readLinksRaw();
  const key = linkKey(safeUserId, safeAccountId);
  if (links.some((link) => linkKey(link.userId, link.accountId) === key)) return;
  links.push({ userId: safeUserId, accountId: safeAccountId });
  writeLinks(links);
}

function removeLink(userId, accountId = "1") {
  const safeUserId = String(userId || "").trim();
  const safeAccountId = String(accountId || "1").trim();
  if (!safeUserId || !safeAccountId) return;
  const key = linkKey(safeUserId, safeAccountId);
  writeLinks(readLinksRaw().filter((link) => linkKey(link.userId, link.accountId) !== key));
}

function removeUserId(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return;
  writeLinks(readLinksRaw().filter((link) => link.userId !== safeUserId));
}

function addUserId(userId) {
  addLink(userId, "1");
}

function readUserIds() {
  return [...new Set(readLinksRaw().map((link) => link.userId))];
}

function accountIdFromSessionFolderName(folderName) {
  const name = String(folderName || "").trim();
  if (name === LEGACY_SESSION_FOLDER) return "1";
  const match = /^session-wa-(\d+)$/.exec(name);
  if (!match) return "";
  return match[1];
}

/**
 * Workspace user IDs that have a persisted WhatsApp Web session on disk (LocalAuth userDataDir).
 */
function discoverLinksFromSessionFolders() {
  const found = [];
  try {
    if (!fs.existsSync(DATA_ROOT)) return found;
    for (const ent of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const uid = ent.name;
      if (!uid || !/^[a-zA-Z0-9_-]+$/.test(uid) || uid.length > 64) continue;
      const authRoot = path.join(DATA_ROOT, uid, "whatsapp-auth");
      if (!fs.existsSync(authRoot)) continue;
      for (const authEnt of fs.readdirSync(authRoot, { withFileTypes: true })) {
        if (!authEnt.isDirectory()) continue;
        const accountId = accountIdFromSessionFolderName(authEnt.name);
        if (!accountId) continue;
        found.push({ userId: uid, accountId });
      }
    }
  } catch {
    /* ignore */
  }
  return found;
}

/**
 * Links to reconnect on server boot: saved list + any session folders on disk.
 */
function readRestoreLinks() {
  const seen = new Set();
  const merged = [];
  [...readLinksRaw(), ...discoverLinksFromSessionFolders()].forEach((link) => {
    const key = linkKey(link.userId, link.accountId);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(link);
  });
  return merged;
}

function readRestoreUserIds() {
  return [...new Set(readRestoreLinks().map((link) => link.userId))];
}

module.exports = {
  readUserIds,
  readRestoreUserIds,
  readRestoreLinks,
  addUserId,
  addLink,
  removeUserId,
  removeLink,
};
