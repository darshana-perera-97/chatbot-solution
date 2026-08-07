export const NOT_ALLOCATED_BADGE_LABEL = "Not Allocated";

const BADGE_COLOR_PRESETS = ["#7C3AED", "#2563EB", "#059669", "#D97706", "#DC2626", "#DB2777"];

export function slugifyBadgeId(label, existingIds = new Set()) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  let id = base || `badge_${Date.now().toString(36).slice(-6)}`;
  if (!existingIds.has(id)) return id;
  let suffix = 2;
  while (existingIds.has(`${id}_${suffix}`)) suffix += 1;
  return `${id}_${suffix}`.slice(0, 40);
}

export function normalizeConversationBadges(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      const label = typeof entry?.label === "string" ? entry.label.trim() : "";
      const color =
        typeof entry?.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(entry.color.trim())
          ? entry.color.trim().toUpperCase()
          : "#7C3AED";
      if (!id || !label) return null;
      return { id, label, color };
    })
    .filter(Boolean);
}

export function findConversationBadge(badgeId, badges) {
  const id = String(badgeId || "").trim();
  if (!id) return null;
  return (Array.isArray(badges) ? badges : []).find((badge) => badge.id === id) || null;
}

export function badgePillStyle(color, { allocated = true } = {}) {
  if (!allocated) {
    return {
      backgroundColor: "#F1F5F9",
      color: "#64748B",
      borderColor: "#CBD5E1",
    };
  }
  const safe = typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#7C3AED";
  return {
    backgroundColor: `${safe}1A`,
    color: safe,
    borderColor: `${safe}55`,
  };
}

export function nextBadgeColor(badges) {
  const used = new Set((Array.isArray(badges) ? badges : []).map((badge) => badge.color));
  const preset = BADGE_COLOR_PRESETS.find((color) => !used.has(color));
  return preset || BADGE_COLOR_PRESETS[(badges?.length || 0) % BADGE_COLOR_PRESETS.length];
}
