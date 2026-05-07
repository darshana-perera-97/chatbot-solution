import { landingPageData } from "./data/landingPageData";

export const SITE_NAME = "AI Agent Workspace";
export const SITE_BRAND = `${landingPageData.brand.product} ${landingPageData.brand.byline}`.trim();

export const DEFAULT_DESCRIPTION =
  "AI Agent workspace for chatbot knowledgebase, test bot conversations, live-agent handoff, leads, and embeddable website chat widget integration.";

export const KEYWORDS =
  "AI chatbot, chatbot builder, NexGenAI, conversational AI, WhatsApp chatbot, website chat widget, knowledgebase, live agent";

const HOME_TITLE = `${landingPageData.hero.title} | ${landingPageData.brand.product}`;
const HOME_DESCRIPTION = landingPageData.hero.description;

/** Paths that should not be indexed (SPA app surfaces, embeds, admin). */
const NOINDEX_PREFIXES = [
  "/dashboard",
  "/chats",
  "/integrations",
  "/knowledgebase",
  "/test-bot",
  "/inquiries",
  "/stock-loads",
  "/settings",
  "/support",
  "/app",
  "/embed",
  "/admin",
];

function shouldNoIndex(pathname) {
  const p = pathname || "/";
  if (p === "/login") return false;
  if (p === "/") return false;
  return NOINDEX_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

const ROUTE_COPY = {
  "/login": {
    title: `Sign in | ${SITE_NAME}`,
    description: `Sign in to ${SITE_NAME} to manage your chatbot, knowledgebase, chats, and integrations.`,
  },
  "/admin/login": {
    title: `Admin sign in | ${SITE_NAME}`,
    description: `Administrator sign-in for ${SITE_NAME}.`,
  },
  "/admin": {
    title: `Admin | ${SITE_NAME}`,
    description: `Admin console for ${SITE_NAME}.`,
  },
  "/dashboard": {
    title: `Dashboard | ${SITE_NAME}`,
    description: `Workspace dashboard: overview of your AI chatbot activity and leads.`,
  },
  "/chats": {
    title: `Chats | ${SITE_NAME}`,
    description: `View and manage customer conversations from web chat and connected channels.`,
  },
  "/integrations": {
    title: `Integrations | ${SITE_NAME}`,
    description: `Connect web embed, WhatsApp, and other channels to your AI agent.`,
  },
  "/knowledgebase": {
    title: `Knowledgebase | ${SITE_NAME}`,
    description: `Manage the knowledge your AI chatbot uses to answer customers.`,
  },
  "/test-bot": {
    title: `Test bot | ${SITE_NAME}`,
    description: `Try your chatbot configuration before publishing.`,
  },
  "/inquiries": {
    title: `Inquiries | ${SITE_NAME}`,
    description: `Review leads and inquiries captured by your chatbot.`,
  },
  "/stock-loads": {
    title: `Stock loads | ${SITE_NAME}`,
    description: `Stock loads workspace.`,
  },
  "/settings": {
    title: `Settings | ${SITE_NAME}`,
    description: `Customize chat widget appearance and copy your website embed code.`,
  },
  "/support": {
    title: `Support | ${SITE_NAME}`,
    description: `Help and support for ${SITE_NAME}.`,
  },
  "/embed/chatbot": {
    title: `Chat widget | ${SITE_NAME}`,
    description: `Embedded chat widget session. Add the script to your site from Settings.`,
  },
};

/**
 * @param {string} pathname
 * @returns {{ title: string, description: string, robots: string }}
 */
export function getSeoForPath(pathname) {
  const path = pathname && pathname.length ? pathname : "/";
  const robots = shouldNoIndex(path) ? "noindex,nofollow" : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

  if (path === "/") {
    return {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      robots,
    };
  }

  const copy = ROUTE_COPY[path];
  if (copy) {
    return { ...copy, robots };
  }

  return {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    robots,
  };
}

/**
 * Absolute site URL for canonical / OG (falls back to window.location.origin in the browser).
 * Set REACT_APP_SITE_URL in production for stable sharing URLs (e.g. https://app.example.com).
 */
export function getSiteOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    const envBase = typeof process !== "undefined" && process.env?.REACT_APP_SITE_URL;
    if (envBase && /^https?:\/\//i.test(String(envBase).trim())) {
      try {
        return new URL(String(envBase).trim()).origin;
      } catch {
        /* fall through */
      }
    }
    return window.location.origin;
  }
  return "";
}
