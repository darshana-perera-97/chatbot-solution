import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getSeoForPath, getSiteOrigin, KEYWORDS, SITE_NAME } from "../seoConfig";

function upsertMetaName(name, content) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertMetaProperty(property, content) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Updates document title and core meta tags per route (SPA SEO baseline).
 */
function SeoHead() {
  const { pathname } = useLocation();
  const seo = getSeoForPath(pathname);

  useEffect(() => {
    document.title = seo.title;

    const origin = getSiteOrigin();
    const path = pathname || "/";
    const canonicalPath = path === "/" || path === "" ? "/" : path;
    const canonical = origin ? `${origin}${canonicalPath}` : path;

    upsertMetaName("description", seo.description);
    upsertMetaName("robots", seo.robots);
    upsertMetaName("keywords", KEYWORDS);

    upsertMetaProperty("og:title", seo.title);
    upsertMetaProperty("og:description", seo.description);
    upsertMetaProperty("og:site_name", SITE_NAME);
    upsertMetaProperty("og:type", "website");
    if (canonical.startsWith("http")) {
      upsertMetaProperty("og:url", canonical);
    }

    upsertMetaName("twitter:title", seo.title);
    upsertMetaName("twitter:description", seo.description);

    if (canonical.startsWith("http")) {
      upsertCanonical(canonical);
    }
  }, [pathname, seo.description, seo.robots, seo.title]);

  return null;
}

export default SeoHead;
