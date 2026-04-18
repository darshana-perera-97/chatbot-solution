(function initChatbotEmbed() {
  if (document.getElementById("nexgen-chatbot-embed-launcher")) return;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    script = scripts[scripts.length - 1];
  }
  if (!script) return;

  var userId = (script.getAttribute("data-user-id") || "").trim();
  var width = Number(script.getAttribute("data-width") || 380);
  var height = Number(script.getAttribute("data-height") || 640);
  var right = script.getAttribute("data-right") || "24px";
  var bottom = script.getAttribute("data-bottom") || "24px";
  var gap = Number(script.getAttribute("data-gap") || 14);
  var zIndex = script.getAttribute("data-z-index") || "2147483000";
  var startOpenAttr = (script.getAttribute("data-start-open") || "").trim().toLowerCase();
  var startOpen = startOpenAttr === "1" || startOpenAttr === "true" || startOpenAttr === "yes";
  var apiBaseAttr = (script.getAttribute("data-api-base") || "").trim();
  var previewThemeAttr = script.getAttribute("data-preview-theme") || "";
  var previewLauncherImageAttr = script.getAttribute("data-preview-launcher-image") || "";
  var previewModeAttr = (script.getAttribute("data-preview-mode") || "").trim().toLowerCase();
  var previewMode = previewModeAttr === "1" || previewModeAttr === "true" || previewModeAttr === "yes";
  var previewThemeRaw = "";
  var previewLauncherImage = "";
  try {
    previewThemeRaw = decodeURIComponent(previewThemeAttr || "");
  } catch (e) {
    previewThemeRaw = "";
  }
  try {
    previewLauncherImage = decodeURIComponent(previewLauncherImageAttr || "");
  } catch (e) {
    previewLauncherImage = "";
  }

  var srcBase = script.src.replace(/\/chatbot-embed\.js(\?.*)?$/, "/embed/chatbot");
  var iframeParams = [];
  if (userId) iframeParams.push("userId=" + encodeURIComponent(userId));
  if (previewThemeRaw) iframeParams.push("previewTheme=" + encodeURIComponent(previewThemeRaw));
  if (previewMode) iframeParams.push("previewMode=1");
  var iframeSrc = srcBase + (iframeParams.length ? "?" + iframeParams.join("&") : "");
  var parsedScriptUrl = null;
  try {
    parsedScriptUrl = new URL(script.src, window.location.href);
  } catch (e) {
    parsedScriptUrl = null;
  }

  function resolveApiBase() {
    if (apiBaseAttr) return apiBaseAttr.replace(/\/$/, "");
    if (parsedScriptUrl && parsedScriptUrl.origin) {
      return parsedScriptUrl.origin;
    }
    return window.location.origin;
  }

  var launcher = document.createElement("button");
  launcher.id = "nexgen-chatbot-embed-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chatbot");
  launcher.style.position = "fixed";
  launcher.style.right = right;
  launcher.style.bottom = bottom;
  launcher.style.width = "58px";
  launcher.style.height = "58px";
  launcher.style.border = "0";
  launcher.style.borderRadius = "999px";
  launcher.style.cursor = "pointer";
  launcher.style.color = "#ffffff";
  launcher.style.fontSize = "24px";
  launcher.style.fontWeight = "700";
  launcher.style.boxShadow = "0 8px 18px rgba(15,23,42,0.18)";
  launcher.style.background = "linear-gradient(135deg,#7C3AED,#A78BFA)";
  launcher.style.backgroundSize = "cover";
  launcher.style.backgroundPosition = "center";
  launcher.style.backgroundRepeat = "no-repeat";
  launcher.style.zIndex = zIndex;
  launcher.textContent = "💬";
  if (previewLauncherImage && /^data:image\//i.test(previewLauncherImage)) {
    launcher.style.backgroundImage = "url(\"" + previewLauncherImage.replace(/"/g, '\\"') + "\")";
    launcher.style.backgroundColor = "transparent";
    launcher.textContent = "";
    launcher.dataset.hasImage = "1";
  }

  var frame = document.createElement("iframe");
  frame.id = "nexgen-chatbot-embed-frame";
  frame.src = iframeSrc;
  frame.title = "NexGenAI Chatbot";
  frame.loading = "lazy";
  frame.allow = "clipboard-write";
  frame.style.position = "fixed";
  frame.style.right = right;
  frame.style.bottom = "calc(" + bottom + " + 58px + " + String(gap) + "px)";
  frame.style.width = String(width) + "px";
  frame.style.height = String(height) + "px";
  frame.style.maxWidth = "calc(100vw - 16px)";
  frame.style.maxHeight = "calc(100vh - 16px)";
  frame.style.border = "0";
  frame.style.overflow = "hidden";
  frame.style.borderRadius = "18px";
  frame.style.boxShadow = "0 12px 28px rgba(15,23,42,0.18)";
  frame.style.background = "transparent";
  frame.style.zIndex = zIndex;
  frame.style.display = "none";

  var isOpen = false;
  function applyResponsiveSize() {
    var vw = window.innerWidth || document.documentElement.clientWidth || width;
    var vh = window.innerHeight || document.documentElement.clientHeight || height;
    var mobile = vw <= 640;

    var horizontalPadding = mobile ? 12 : 16;
    var maxFrameWidth = Math.max(280, vw - horizontalPadding);
    var computedWidth = Math.min(width, maxFrameWidth);
    frame.style.width = String(computedWidth) + "px";

    // Keep room for launcher + gap below the chat window.
    var launcherSpace = 58 + gap + 14;
    var availableHeight = Math.max(300, vh - launcherSpace - (mobile ? 12 : 16));
    var computedHeight = Math.min(height, availableHeight);
    frame.style.height = String(computedHeight) + "px";

    if (mobile) {
      frame.style.right = "6px";
      frame.style.bottom = "calc(" + bottom + " + 58px + " + String(gap) + "px)";
      launcher.style.right = "10px";
      launcher.style.bottom = "10px";
    } else {
      frame.style.right = right;
      frame.style.bottom = "calc(" + bottom + " + 58px + " + String(gap) + "px)";
      launcher.style.right = right;
      launcher.style.bottom = bottom;
    }
  }

  function setOpen(next) {
    isOpen = !!next;
    frame.style.display = isOpen ? "block" : "none";
    launcher.setAttribute("aria-label", isOpen ? "Close chatbot" : "Open chatbot");
    if (launcher.dataset.hasImage === "1") {
      launcher.textContent = "";
      return;
    }
    launcher.textContent = isOpen ? "×" : "💬";
  }

  launcher.addEventListener("click", function () {
    setOpen(!isOpen);
  });

  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var data = event.data || {};
    if (data && data.type === "NEXGEN_CHATBOT_CLOSE") {
      setOpen(false);
    }
  });

  applyResponsiveSize();
  if (startOpen) {
    setOpen(true);
  }
  window.addEventListener("resize", applyResponsiveSize);
  window.addEventListener("orientationchange", applyResponsiveSize);

  if (userId && !previewLauncherImage) {
    var settingsUrl =
      resolveApiBase() +
      "/widget-settings" +
      "?userId=" +
      encodeURIComponent(userId) +
      "&_ts=" +
      Date.now();
    fetch(settingsUrl, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json().catch(function () {
          return null;
        });
      })
      .then(function (payload) {
        var image = payload && payload.settings && typeof payload.settings.launcherImage === "string"
          ? payload.settings.launcherImage.trim()
          : "";
        if (!image || !/^data:image\//i.test(image)) return;
        launcher.style.backgroundImage = "url(\"" + image.replace(/"/g, '\\"') + "\")";
        launcher.style.backgroundColor = "transparent";
        launcher.textContent = "";
        launcher.dataset.hasImage = "1";
      })
      .catch(function () {
        /* no-op */
      });
  }

  document.body.appendChild(frame);
  document.body.appendChild(launcher);
})();
