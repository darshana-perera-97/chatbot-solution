/**
 * Single place for the default backend API origin (no trailing slash).
 * Production / staging: set REACT_APP_API_BASE_URL so `apiUrl()` uses that instead.
 */
const defaultBackendOrigin = "http://localhost:1248";

module.exports = { defaultBackendOrigin };
