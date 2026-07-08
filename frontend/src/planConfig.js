export const PLAN_WHATSAPP_ACCOUNT_LIMITS = {
  Test: 1,
  Trial: 1,
  Basic: 2,
  Intermediate: 4,
  Pro: 6,
};

export function normalizePlan(plan) {
  if (typeof plan !== "string") return "";
  const cleaned = plan.trim().toLowerCase();
  if (cleaned === "test") return "Test";
  if (cleaned === "trial") return "Trial";
  if (cleaned === "basic") return "Basic";
  if (cleaned === "intermediate") return "Intermediate";
  if (cleaned === "pro") return "Pro";
  return "";
}

export function getWhatsAppAccountLimit(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return 1;
  return PLAN_WHATSAPP_ACCOUNT_LIMITS[normalized] ?? 1;
}
