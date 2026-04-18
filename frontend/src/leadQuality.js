/**
 * Completeness of a lead vs fields configured for capture (fieldLabels on the lead).
 */
export function getLeadQualityParts(row) {
  const collected = Number(row?.collectedCount) || 0;
  const labels = Array.isArray(row?.fieldLabels) ? row.fieldLabels : [];
  const total = labels.map((f) => String(f || "").trim()).filter(Boolean).length;
  if (total <= 0) {
    return { collected, total: 0, percent: null };
  }
  const raw = (collected / total) * 100;
  const percent = Math.min(100, Math.max(0, Math.round(raw)));
  return { collected, total, percent };
}
