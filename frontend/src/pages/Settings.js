import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";
import {
  nextBadgeColor,
  normalizeConversationBadges,
  slugifyBadgeId,
} from "../conversationBadges";

const colorFields = [
  {
    key: "headerColor",
    label: "Chat header",
    hint: "Header bar color of the chat bubble.",
  },
  {
    key: "senderMessageBgColor",
    label: "Sender message bg",
    hint: "Background color for sender/user messages.",
  },
  {
    key: "senderMessageTextColor",
    label: "Sender message text",
    hint: "Text color for sender/user messages.",
  },
  {
    key: "receiverMessageBgColor",
    label: "Receiver message bg",
    hint: "Background color for receiver/assistant messages.",
  },
  {
    key: "receiverMessageTextColor",
    label: "Receiver message text",
    hint: "Text color for receiver/assistant messages.",
  },
  {
    key: "sendButtonColor",
    label: "Send button",
    hint: "Background color for the send button.",
  },
];

function Settings() {
  const profile = getWorkspaceUserProfile();
  const userId = profile?.id ? String(profile.id).trim() : "";
  const [form, setForm] = useState({
    primaryColor: "#7C3AED",
    accentColor: "#A78BFA",
    backgroundColor: "#FCFAFF",
    textColor: "#0F172A",
    headerColor: "#7C3AED",
    senderMessageBgColor: "#7C3AED",
    senderMessageTextColor: "#FFFFFF",
    receiverMessageBgColor: "#FFFFFF",
    receiverMessageTextColor: "#1E293B",
    sendButtonColor: "#7C3AED",
    launcherImage: "",
    aiRepliesEnabled: true,
    conversationBadges: [],
  });
  const [newBadgeLabel, setNewBadgeLabel] = useState("");
  const [newBadgeColor, setNewBadgeColor] = useState("#7C3AED");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState({
    primaryColor: "#7C3AED",
    accentColor: "#A78BFA",
    backgroundColor: "#FCFAFF",
    textColor: "#0F172A",
    headerColor: "#7C3AED",
    senderMessageBgColor: "#7C3AED",
    senderMessageTextColor: "#FFFFFF",
    receiverMessageBgColor: "#FFFFFF",
    receiverMessageTextColor: "#1E293B",
    sendButtonColor: "#7C3AED",
    launcherImage: "",
    aiRepliesEnabled: true,
    conversationBadges: [],
  });

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      setLoading(true);
      setError("");
      try {
        if (!userId) {
          if (!active) return;
          setLoading(false);
          return;
        }
        const res = await fetch(apiUrl(`/widget-settings?userId=${encodeURIComponent(userId)}`));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Could not load settings");
        if (!active) return;
        const settings = data?.settings || {};
        const next = {
          primaryColor: settings.primaryColor || "#7C3AED",
          accentColor: settings.accentColor || "#A78BFA",
          backgroundColor: settings.backgroundColor || "#FCFAFF",
          textColor: settings.textColor || "#0F172A",
          headerColor: settings.headerColor || "#7C3AED",
          senderMessageBgColor: settings.senderMessageBgColor || "#7C3AED",
          senderMessageTextColor: settings.senderMessageTextColor || "#FFFFFF",
          receiverMessageBgColor: settings.receiverMessageBgColor || "#FFFFFF",
          receiverMessageTextColor: settings.receiverMessageTextColor || "#1E293B",
          sendButtonColor: settings.sendButtonColor || "#7C3AED",
          launcherImage: typeof settings.launcherImage === "string" ? settings.launcherImage : "",
          aiRepliesEnabled: settings.aiRepliesEnabled !== false,
          conversationBadges: normalizeConversationBadges(settings.conversationBadges),
        };
        setForm(next);
        setLastSaved(next);
        setNewBadgeColor(nextBadgeColor(next.conversationBadges));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load settings");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadSettings();
    return () => {
      active = false;
    };
  }, [userId]);

  const iframeSrc = useMemo(() => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/embed/chatbot`;
    if (!userId) return base;
    return `${base}?userId=${encodeURIComponent(userId)}`;
  }, [userId]);

  const embedScriptSrc = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/chatbot-embed.js`;
  }, []);
  const embedApiBase = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      return new URL(apiUrl("/widget-settings"), window.location.origin).origin;
    } catch {
      return "";
    }
  }, []);
  const iframeCode = `<script src="${embedScriptSrc}" data-user-id="${userId}"${
    embedApiBase ? ` data-api-base="${embedApiBase}"` : ""
  } defer></script>`;
  const livePreviewTheme = useMemo(
    () => ({
      headerColor: form.headerColor,
      senderMessageBgColor: form.senderMessageBgColor,
      senderMessageTextColor: form.senderMessageTextColor,
      receiverMessageBgColor: form.receiverMessageBgColor,
      receiverMessageTextColor: form.receiverMessageTextColor,
      sendButtonColor: form.sendButtonColor,
      backgroundColor: form.backgroundColor,
      textColor: form.textColor,
    }),
    [
      form.headerColor,
      form.senderMessageBgColor,
      form.senderMessageTextColor,
      form.receiverMessageBgColor,
      form.receiverMessageTextColor,
      form.sendButtonColor,
      form.backgroundColor,
      form.textColor,
    ]
  );
  const previewThemeAttr = useMemo(
    () => encodeURIComponent(JSON.stringify(livePreviewTheme)),
    [livePreviewTheme]
  );
  const previewLauncherImageAttr = useMemo(
    () => encodeURIComponent(form.launcherImage || ""),
    [form.launcherImage]
  );
  const livePreviewDoc = useMemo(
    () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background: #f8f5ff;
        overflow: hidden;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .hint {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        font-size: 12px;
        color: #64748b;
        background: rgba(255, 255, 255, 0.85);
        border: 1px solid #e9dfff;
        border-radius: 10px;
        padding: 8px 10px;
      }
    </style>
  </head>
  <body>
    <div class="hint">Real embed preview: floating launcher + widget behavior.</div>
    <script src="${embedScriptSrc}" data-user-id="${userId}"${
      embedApiBase ? ` data-api-base="${embedApiBase}"` : ""
    } data-preview-theme="${previewThemeAttr}" data-preview-launcher-image="${previewLauncherImageAttr}" data-preview-mode="true" data-start-open="true" defer></script>
  </body>
</html>`,
    [embedScriptSrc, userId, embedApiBase, previewThemeAttr, previewLauncherImageAttr]
  );
  const hasChanges =
    form.primaryColor !== lastSaved.primaryColor ||
    form.accentColor !== lastSaved.accentColor ||
    form.backgroundColor !== lastSaved.backgroundColor ||
    form.textColor !== lastSaved.textColor ||
    form.headerColor !== lastSaved.headerColor ||
    form.senderMessageBgColor !== lastSaved.senderMessageBgColor ||
    form.senderMessageTextColor !== lastSaved.senderMessageTextColor ||
    form.receiverMessageBgColor !== lastSaved.receiverMessageBgColor ||
    form.receiverMessageTextColor !== lastSaved.receiverMessageTextColor ||
    form.sendButtonColor !== lastSaved.sendButtonColor ||
    form.launcherImage !== lastSaved.launcherImage ||
    form.aiRepliesEnabled !== lastSaved.aiRepliesEnabled ||
    JSON.stringify(form.conversationBadges) !== JSON.stringify(lastSaved.conversationBadges);

  const onAddBadge = () => {
    const label = newBadgeLabel.trim();
    if (!label) {
      setError("Enter a badge label.");
      return;
    }
    if (form.conversationBadges.length >= 30) {
      setError("You can add up to 30 badges.");
      return;
    }
    const existingIds = new Set(form.conversationBadges.map((badge) => badge.id));
    const id = slugifyBadgeId(label, existingIds);
    const nextBadges = [
      ...form.conversationBadges,
      { id, label: label.slice(0, 40), color: newBadgeColor },
    ];
    setForm((prev) => ({ ...prev, conversationBadges: nextBadges }));
    setNewBadgeLabel("");
    setNewBadgeColor(nextBadgeColor(nextBadges));
    setError("");
    setStatus("");
  };

  const onRemoveBadge = (badgeId) => {
    setForm((prev) => ({
      ...prev,
      conversationBadges: prev.conversationBadges.filter((badge) => badge.id !== badgeId),
    }));
    setStatus("");
  };

  const onUpdateBadge = (badgeId, patch) => {
    setForm((prev) => ({
      ...prev,
      conversationBadges: prev.conversationBadges.map((badge) =>
        badge.id === badgeId ? { ...badge, ...patch } : badge
      ),
    }));
    setStatus("");
  };

  const onLauncherFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 320 * 1024) {
      setError("Image is too large. Please use an image under 320KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        setError("Could not read image file.");
        return;
      }
      setForm((prev) => ({ ...prev, launcherImage: dataUrl }));
      setError("");
      setStatus("");
    };
    reader.onerror = () => setError("Could not read image file.");
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    if (!userId || saving || !hasChanges) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch(apiUrl("/widget-settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not save settings");
      setStatus("Widget settings saved.");
      const savedForm = {
        ...form,
        conversationBadges: normalizeConversationBadges(data?.settings?.conversationBadges || form.conversationBadges),
      };
      setForm(savedForm);
      setLastSaved(savedForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-2 text-sm text-slate-400">Customize your premium embed chatbot look and copy the embed script snippet.</p>
      </header>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-[#EEE8FF] bg-gradient-to-b from-white to-[#FCFAFF] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Chatbot appearance</h2>
              <p className="mt-1 text-sm text-slate-500">
                Minimal controls for theme colors and floating launcher button image.
              </p>
            </div>
            <div className="rounded-xl border border-[#E9DFFF] bg-white px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quick palette</p>
              <div className="mt-2 flex items-center gap-1.5">
                {colorFields.map(({ key, label }) => (
                  <span
                    key={key}
                    title={label}
                    className="h-5 w-5 rounded-full border border-white shadow"
                    style={{ backgroundColor: form[key] }}
                  />
                ))}
              </div>
            </div>
          </div>

          {loading ? <p className="mt-3 text-sm text-slate-500">Loading settings...</p> : null}
          <div className="mt-5 space-y-3.5">
            {colorFields.map(({ key, label, hint }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#EEE8FF] bg-white px-3 py-3 shadow-[0_4px_12px_rgba(124,58,237,0.05)]"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className="h-8 w-8 rounded-full border border-white shadow ring-1 ring-[#E9DFFF]"
                    style={{ backgroundColor: form[key] }}
                  />
                  <input
                    type="color"
                    value={form[key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="h-9 w-11 cursor-pointer rounded-lg border border-[#DDD6FE] bg-white p-1"
                  />
                  <input
                    type="text"
                    value={form[key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-28 rounded-lg border border-[#E9DFFF] bg-[#FCFAFF] px-2.5 py-1.5 text-xs font-semibold uppercase text-slate-700 outline-none transition focus:border-[#C4B5FD] focus:ring-2 focus:ring-[#8B5CF6]/20"
                    maxLength={7}
                  />
                </div>
              </label>
            ))}

            <div className="rounded-xl border border-[#EEE8FF] bg-white px-3 py-3 shadow-[0_4px_12px_rgba(124,58,237,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Floating button image</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Upload PNG/JPG/WebP/GIF (max 320KB). This image is shown on the launcher bubble.
                  </p>
                </div>
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[#E9DFFF] bg-[#F8F5FF]">
                  {form.launcherImage ? (
                    <img src={form.launcherImage} alt="Launcher preview" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl">💬</div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#F8F5FF]">
                  Upload image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                    className="hidden"
                    onChange={onLauncherFileChange}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, launcherImage: "" }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Remove image
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-[#EEE8FF] bg-white px-3 py-3 shadow-[0_4px_12px_rgba(124,58,237,0.05)]">
            <div>
              <p className="text-sm font-semibold text-slate-800">Conversation badges</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Create badges your team can assign to conversations on the Chats page. Each conversation can have one badge.
              </p>
            </div>

            {form.conversationBadges.length ? (
              <ul className="mt-3 space-y-2">
                {form.conversationBadges.map((badge) => (
                  <li
                    key={badge.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[#EEE8FF] bg-[#FCFAFF] px-2.5 py-2"
                  >
                    <span
                      className="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        backgroundColor: `${badge.color}1A`,
                        color: badge.color,
                        borderColor: `${badge.color}55`,
                      }}
                    >
                      {badge.label}
                    </span>
                    <input
                      type="text"
                      value={badge.label}
                      onChange={(e) => onUpdateBadge(badge.id, { label: e.target.value.slice(0, 40) })}
                      className="min-w-0 flex-1 rounded-lg border border-[#E9DFFF] bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-[#C4B5FD]"
                      maxLength={40}
                    />
                    <input
                      type="color"
                      value={badge.color}
                      onChange={(e) => onUpdateBadge(badge.id, { color: e.target.value.toUpperCase() })}
                      className="h-9 w-11 cursor-pointer rounded-lg border border-[#DDD6FE] bg-white p-1"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveBadge(badge.id)}
                      className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No badges yet. Add your first badge below.</p>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-[160px] flex-1">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  New badge label
                </span>
                <input
                  type="text"
                  value={newBadgeLabel}
                  onChange={(e) => setNewBadgeLabel(e.target.value)}
                  placeholder="e.g. VIP, Follow up"
                  maxLength={40}
                  className="w-full rounded-lg border border-[#E9DFFF] bg-[#FCFAFF] px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-[#C4B5FD] focus:ring-2 focus:ring-[#8B5CF6]/20"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Color
                </span>
                <input
                  type="color"
                  value={newBadgeColor}
                  onChange={(e) => setNewBadgeColor(e.target.value.toUpperCase())}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-[#DDD6FE] bg-white p-1"
                />
              </label>
              <button
                type="button"
                onClick={onAddBadge}
                className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#F8F5FF]"
              >
                Add badge
              </button>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !userId || !hasChanges}
              className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/25 transition hover:opacity-95 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            {status ? <p className="text-sm font-medium text-emerald-700">{status}</p> : null}
          </div>
          {error ? <p className="mt-2 text-sm font-medium text-red-600">{error}</p> : null}
        </article>

        <article className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Live Preview</h2>
          <div className="mt-4 rounded-2xl border border-[#E9DFFF] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Live Preview
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Real embed behavior with floating launcher
            </p>
            <div className="mt-3 flex justify-center rounded-xl bg-[#F8F5FF] p-3">
              <iframe
                title="Chatbot preview"
                srcDoc={livePreviewDoc}
                width={380}
                height={640}
                style={{ border: 0, overflow: "hidden", borderRadius: 16 }}
                loading="lazy"
                allow="clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

export default Settings;
