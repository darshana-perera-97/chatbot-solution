import { defaultBackendOrigin } from "./backendConfig.js";

const DEFAULT_LOCAL_API = defaultBackendOrigin;
function normalizeBase(url) {
  return (url || "").trim().replace(/\/$/, "");
}

function isLocalBrowserHost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

/**
 * Base URL for HTTP API calls (no trailing slash).
 *
 * Order of resolution:
 * 1. `REACT_APP_API_BASE_URL` if set (use this for real deployments).
 * 2. Default origin from `src/backendConfig.js` (`defaultBackendOrigin`) — change that file when your local backend port/host differs.
 * 3. Production bundle opened on localhost / 127.0.0.1 (e.g. `serve -s build`):
 *    same default so login works without rebuilding env vars (still uses backendConfig.js).
 * 4. Otherwise same-origin relative paths (expects API behind the same host).
 */
export function apiUrl(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const fromEnv = normalizeBase(process.env.REACT_APP_API_BASE_URL);
  if (fromEnv) return `${fromEnv}${normalized}`;
  if (process.env.NODE_ENV === "development") {
    return `${DEFAULT_LOCAL_API}${normalized}`;
  }
  if (isLocalBrowserHost()) {
    return `${DEFAULT_LOCAL_API}${normalized}`;
  }
  return normalized;
}
