const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "data", "whatsapp-autostart.json");
/** Same root as `whatsappBridge` LocalAuth `dataPath` — folders `session-wa-<userId>`. */
const WHATSAPP_AUTH_ROOT = path.join(__dirname, "data", "whatsapp-auth");
const SESSION_FOLDER_PREFIX = "session-wa-";

function ensureDir() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readUserIds() {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const list = Array.isArray(parsed.userIds) ? parsed.userIds : [];
    return [...new Set(list.map((id) => String(id || "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function writeUserIds(ids) {
  ensureDir();
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  fs.writeFileSync(FILE_PATH, JSON.stringify({ userIds: unique }, null, 2), "utf8");
}

function addUserId(userId) {
  const safe = String(userId || "").trim();
  if (!safe) return;
  const ids = readUserIds();
  if (ids.includes(safe)) return;
  ids.push(safe);
  writeUserIds(ids);
}

function removeUserId(userId) {
  const safe = String(userId || "").trim();
  if (!safe) return;
  writeUserIds(readUserIds().filter((id) => id !== safe));
}

/**
 * Workspace user IDs that have a persisted WhatsApp Web session on disk (LocalAuth userDataDir).
 */
function discoverUserIdsFromSessionFolders() {
  const found = [];
  try {
    if (!fs.existsSync(WHATSAPP_AUTH_ROOT)) return found;
    for (const ent of fs.readdirSync(WHATSAPP_AUTH_ROOT, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (!name.startsWith(SESSION_FOLDER_PREFIX)) continue;
      const uid = name.slice(SESSION_FOLDER_PREFIX.length);
      if (uid && /^[a-zA-Z0-9_-]+$/.test(uid) && uid.length <= 64) found.push(uid);
    }
  } catch {
    /* ignore */
  }
  return found;
}

/**
 * User IDs to reconnect on server boot: saved list + any `session-wa-*` folders (survives missing JSON).
 */
function readRestoreUserIds() {
  return [...new Set([...readUserIds(), ...discoverUserIdsFromSessionFolders()])];
}

module.exports = {
  readUserIds,
  readRestoreUserIds,
  addUserId,
  removeUserId,
};
