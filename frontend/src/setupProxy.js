const { createProxyMiddleware } = require("http-proxy-middleware");
const { defaultBackendOrigin } = require("./backendConfig.js");

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_PROXY_TARGET || defaultBackendOrigin;

  // http-proxy-middleware v2 uses a function `context`, not `filter`.
  // Browser navigations to `/admin/*` must be served by the React dev server (SPA).
  const shouldProxyAdminRequest = (pathname, req) => {
    if (!pathname.startsWith("/admin")) return false;
    if (req.method !== "GET") return true;
    const accept = req.headers.accept || "";
    return !accept.includes("text/html");
  };

  app.use(
    createProxyMiddleware(shouldProxyAdminRequest, {
      target,
      changeOrigin: true,
    })
  );
};
