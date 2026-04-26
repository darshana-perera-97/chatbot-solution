/**
 * Single place for the default backend API origin (no trailing slash).
 * Production / staging: set REACT_APP_API_BASE_URL so `apiUrl()` uses that instead.
 */
// const defaultBackendOrigin = "http://localhost:1248";
// const defaultBackendOrigin = "http://93.127.129.102:1248";
const defaultBackendOrigin = "https://ai-chatbot.nexgenai.asia";

module.exports = { defaultBackendOrigin };
