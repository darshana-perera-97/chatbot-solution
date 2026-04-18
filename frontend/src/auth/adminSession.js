const ADMIN_SESSION_KEY = "dashyat_admin_session";

export function setAdminSession() {
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
}

export function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function isAdminAuthenticated() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}
