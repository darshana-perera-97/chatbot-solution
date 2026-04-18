const USER_ID_KEY = "workspace_user_id";
const LOGIN_POPUP_KEY = "workspace_login_popup";
const USER_PROFILE_KEY = "workspace_user_profile";

export function setWorkspaceUserId(userId, persist = true) {
  const value = typeof userId === "string" ? userId.trim() : String(userId || "").trim();
  if (!value) return;
  if (persist) {
    localStorage.setItem(USER_ID_KEY, value);
    sessionStorage.removeItem(USER_ID_KEY);
    return;
  }
  sessionStorage.setItem(USER_ID_KEY, value);
  localStorage.removeItem(USER_ID_KEY);
}

export function getWorkspaceUserId() {
  return localStorage.getItem(USER_ID_KEY) || sessionStorage.getItem(USER_ID_KEY) || "";
}

export function clearWorkspaceUserId() {
  localStorage.removeItem(USER_ID_KEY);
  sessionStorage.removeItem(USER_ID_KEY);
}

export function triggerWorkspaceLoginPopup(userLabel = "") {
  const payload = {
    userLabel: typeof userLabel === "string" ? userLabel.trim() : "",
    loggedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(LOGIN_POPUP_KEY, JSON.stringify(payload));
}

export function consumeWorkspaceLoginPopup() {
  const raw = sessionStorage.getItem(LOGIN_POPUP_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(LOGIN_POPUP_KEY);
  try {
    const parsed = JSON.parse(raw);
    return {
      userLabel: typeof parsed.userLabel === "string" ? parsed.userLabel : "",
      loggedAt: typeof parsed.loggedAt === "string" ? parsed.loggedAt : "",
    };
  } catch {
    return null;
  }
}

export function setWorkspaceUserProfile(user, persist = true) {
  if (!user || typeof user !== "object") return;
  const profile = {
    id: user.id || "",
    username: user.username || "",
    email: user.email || "",
    plan: user.plan || "",
    status: user.status || "",
  };
  const serialized = JSON.stringify(profile);
  if (persist) {
    localStorage.setItem(USER_PROFILE_KEY, serialized);
    sessionStorage.removeItem(USER_PROFILE_KEY);
    return;
  }
  sessionStorage.setItem(USER_PROFILE_KEY, serialized);
  localStorage.removeItem(USER_PROFILE_KEY);
}

export function getWorkspaceUserProfile() {
  const raw = localStorage.getItem(USER_PROFILE_KEY) || sessionStorage.getItem(USER_PROFILE_KEY) || "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearWorkspaceUserSession() {
  clearWorkspaceUserId();
  localStorage.removeItem(USER_PROFILE_KEY);
  sessionStorage.removeItem(USER_PROFILE_KEY);
}
