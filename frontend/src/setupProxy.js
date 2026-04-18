const { createProxyMiddleware } = require("http-proxy-middleware");
const { defaultBackendOrigin } = require("./backendConfig.js");

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_PROXY_TARGET || defaultBackendOrigin;
  app.use(
    "/admin",
    createProxyMiddleware({
      target,
      changeOrigin: true,
      // Browser navigations to `/admin/*` must be served by the React dev server (SPA).
      // Only proxy non-document requests; API calls in dev often use `apiUrl()` straight to backendConfig origin.
      filter: (_pathname, req) => {
        if (req.method !== "GET") return true;
        const accept = req.headers.accept || "";
        return !accept.includes("text/html");
      },
    })
  );
};
