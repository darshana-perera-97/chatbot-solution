const ALLOWED_PLANS = new Set(["Test", "Trial", "Basic", "Intermediate", "Pro"]);

const PLAN_TRIAL_DAYS = {
  Test: 7,
  Trial: 30,
};

const PLAN_WHATSAPP_ACCOUNT_LIMITS = {
  Test: 1,
  Trial: 1,
  Basic: 2,
  Intermediate: 4,
  Pro: 6,
};

const normalizePlan = (plan) => {
  if (typeof plan !== "string") return "";
  const cleaned = plan.trim().toLowerCase();
  if (cleaned === "test") return "Test";
  if (cleaned === "trial") return "Trial";
  if (cleaned === "basic") return "Basic";
  if (cleaned === "intermediate") return "Intermediate";
  if (cleaned === "pro") return "Pro";
  return "";
};

const getWhatsAppAccountLimit = (plan) => {
  const normalized = normalizePlan(plan);
  if (!normalized) return 0;
  return PLAN_WHATSAPP_ACCOUNT_LIMITS[normalized] ?? 0;
};

const sanitizeWhatsAppAccountId = (raw, maxAccountId = 6) => {
  const s = String(raw || "1").trim();
  if (!/^[1-9]\d*$/.test(s)) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > maxAccountId) return "";
  return String(n);
};

module.exports = {
  ALLOWED_PLANS,
  PLAN_TRIAL_DAYS,
  PLAN_WHATSAPP_ACCOUNT_LIMITS,
  normalizePlan,
  getWhatsAppAccountLimit,
  sanitizeWhatsAppAccountId,
};
