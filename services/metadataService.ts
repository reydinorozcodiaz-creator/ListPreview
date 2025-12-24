import { MetadataResponse } from "../types";

// Heuristic to avoid storing URLs that are not actual images
const isLikelyImageUrl = (candidate?: string | null): boolean => {
  if (!candidate) return false;
  const lower = candidate.split("#")[0].toLowerCase();
  if (lower.startsWith("data:image/")) return true;
  if (lower.startsWith("blob:")) return true;
  // Avoid typical icon/favicons for card backgrounds
  if (lower.includes("google.com/s2/favicons")) return false;
  if (lower.includes("/favicon") || lower.includes("favicon=")) return false;
  if (/(\.)(ico)(\?|$)/.test(lower)) return false;
  return /(\.)(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(lower);
};

const parseSizeFromUrl = (u: string) => {
  const lower = u.split("#")[0].toLowerCase();
  const m = lower.match(
    /[-_](\d{2,4})x(\d{2,4})(?=\.(png|jpe?g|webp|avif|gif|svg)(\?|$))/
  );
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { w, h, area: w * h };
};

const resolveCandidateUrl = (baseUrl: string, candidate: string) => {
  const raw = (candidate || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.startsWith("data:image/") || lower.startsWith("blob:")) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
};

const isAllowedImageHost = (pageUrl: string, imageUrl: string) => {
  try {
    const page = new URL(pageUrl);
    const img = new URL(imageUrl);

    const pageHost = page.hostname.toLowerCase();
    const imgHost = img.hostname.toLowerCase();

    // Same host or subdomain of the same site
    if (imgHost === pageHost || imgHost.endsWith(`.${pageHost}`)) return true;

    // Common WordPress CDN hosts
    if (
      imgHost === "i0.wp.com" ||
      imgHost === "i1.wp.com" ||
      imgHost === "i2.wp.com"
    )
      return true;

    return false;
  } catch {
    return false;
  }
};

const looksLikeLogoish = (u: string) => {
  const lower = u.split("#")[0].toLowerCase();
  return (
    lower.includes("site-logo") ||
    lower.includes("custom-logo") ||
    lower.includes("header-logo") ||
    lower.includes("brand") ||
    lower.includes("icon") ||
    lower.includes("avatar") ||
    lower.includes("gravatar") ||
    lower.includes("sprite") ||
    lower.includes("favicon") ||
    /[-_](16|24|32|48|64|96|128|150|180|192|256)x\1(?=\.)/.test(lower) ||
    /[-_](150|300)x(150|300)(?=\.)/.test(lower)
  );
};

const scoreImageUrl = (u: string) => {
  const lower = u.split("#")[0].toLowerCase();
  let score = 0;

  // Strongly prefer WordPress uploads (usually the real content images)
  if (lower.includes("/wp-content/uploads/")) score += 6;
  // Penalize theme/plugin assets which are often logos/icons
  if (
    lower.includes("/wp-content/themes/") ||
    lower.includes("/wp-content/plugins/")
  ) {
    score -= 4;
  }

  // File type preferences (photos > logos/icons)
  if (/(\.)(jpe?g)(\?|$)/.test(lower)) score += 6;
  else if (/(\.)(webp|avif)(\?|$)/.test(lower)) score += 5;
  else if (/(\.)(png)(\?|$)/.test(lower)) score += 2;
  else if (/(\.)(gif|svg)(\?|$)/.test(lower)) score += 1;

  // Explicit main/featured naming patterns
  if (/(^|[\/_-])img[_-]?main([\._-]|$)/.test(lower)) score += 10;
  if (/(^|[\/_-])(featured|hero|cover)([\._-]|$)/.test(lower)) score += 4;
  if (/(^|[\/_-])(banner|header)([\._-]|$)/.test(lower)) score -= 6;

  const sz = parseSizeFromUrl(lower);
  if (sz) {
    score += Math.min(12, sz.area / 100000);
    if (sz.w >= 900 || sz.h >= 600) score += 2;

    // Penalize banner-like aspect ratios (very wide/tall images)
    const ratio = sz.h === 0 ? 0 : sz.w / sz.h;
    if (ratio >= 4 || ratio <= 0.25) score -= 10;
    else if (ratio >= 3 || ratio <= 0.33) score -= 6;

    // Penalize small thumbnail variants (often from related posts widgets)
    if (sz.w < 500 || sz.h < 300) score -= 6;
    else if (sz.w < 800) score -= 2;
  } else {
    // No size hint in filename: slightly less confidence than WP sized variants
    score -= 1;
  }

  if (looksLikeLogoish(lower)) score -= 8;
  if (lower.includes("google.com/s2/favicons")) score -= 50;
  if (lower.includes("/favicon") || /(\.)(ico)(\?|$)/.test(lower)) score -= 50;

  return score;
};

const pickBestImage = (
  pageUrl: string,
  candidates: string[],
  opts?: { allowExternalHosts?: boolean }
) => {
  const resolved = candidates
    .map((c) => resolveCandidateUrl(pageUrl, c))
    .filter(Boolean);

  const uniq = Array.from(new Set(resolved));
  const filtered = uniq.filter(isLikelyImageUrl).filter((u) => {
    if (!u.startsWith("http")) return true;
    if (opts?.allowExternalHosts) return true;
    return isAllowedImageHost(pageUrl, u);
  });
  if (filtered.length === 0) return undefined;

  let best = filtered[0];
  let bestScore = scoreImageUrl(best);

  for (const c of filtered.slice(1)) {
    const s = scoreImageUrl(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }

  // If everything is weak/ambiguous, prefer no image (UI will use fallback)
  if (bestScore < 2) return undefined;

  // If allowing external hosts, require a stronger score (avoid random embeds)
  if (opts?.allowExternalHosts) {
    try {
      const bestUrl = new URL(best);
      const page = new URL(pageUrl);
      const sameSite =
        bestUrl.hostname.toLowerCase() === page.hostname.toLowerCase() ||
        bestUrl.hostname
          .toLowerCase()
          .endsWith(`.${page.hostname.toLowerCase()}`);
      if (!sameSite && bestScore < 6) return undefined;
    } catch {
      // ignore
    }
  }
  return best;
};

const parseSrcsetLargest = (srcset: string | null) => {
  if (!srcset) return null;
  const parts = srcset
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let bestUrl: string | null = null;
  let bestW = -1;

  for (const p of parts) {
    const m = p.match(/^(\S+)\s+(\d+)w$/);
    if (!m) continue;
    const url = m[1];
    const w = Number(m[2]);
    if (Number.isFinite(w) && w > bestW) {
      bestW = w;
      bestUrl = url;
    }
  }

  return bestUrl;
};

/**
 * Obtiene metadatos de una URL utilizando AllOrigins con un fallback a r.jina.ai
 * para saltar bloqueos agresivos (Cloudflare, 403, etc).
 */
export const fetchMetadata = async (url: string): Promise<MetadataResponse> => {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;
  let html = "";
  let isMarkdown = false;

  // 1. Intento con AllOrigins (Proxy HTML)
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
      targetUrl
    )}&_=${Date.now()}`;
    const response = await fetch(proxyUrl);
    if (response.ok) {
      html = await response.text();
      // Verificación de bloqueos comunes
      const forbidden =
        html.toLowerCase().includes("forbidden") ||
        html.toLowerCase().includes("403 forbidden");
      const cloudflare =
        html.includes("cf-browser-verification") || html.includes("cloudflare");
      if (forbidden || cloudflare || html.length < 600) {
        html = "";
      }
    }
  } catch (e) {
    console.warn("AllOrigins falló o fue bloqueado.");
  }

  // 2. Fallback con r.jina.ai (Extremadamente efectivo para sitios con Cloudflare/403)
  if (!html) {
    try {
      const jinaUrl = `https://r.jina.ai/${targetUrl}`;
      const response = await fetch(jinaUrl);
      if (response.ok) {
        html = await response.text();
        isMarkdown = true;
      }
    } catch (e) {
      console.error("Proxy r.jina.ai también falló.");
    }
  }

  if (!html) {
    return { title: "Enlace Guardado", url: targetUrl };
  }

  // 3. Extracción de datos
  let title = "Enlace Guardado";
  let image = undefined;

  if (isMarkdown) {
    // Parsing para formato Markdown (Jina)
    const titleMatch = html.match(/^Title:\s*(.*)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    // Búsqueda de imágenes en Markdown (patrón ![alt](url))
    const imgMatches = [...html.matchAll(/!\[.*?\]\((https?:\/\/.*?)\)/g)];
    if (imgMatches.length > 0) {
      const candidates = imgMatches.map((m) => m[1]);
      image = pickBestImage(targetUrl, candidates);
    } else {
      // Búsqueda cruda de URLs de imagen si el patrón falló
      const rawImgMatch = html.match(
        /(https?:\/\/.*?\.(?:png|jpg|jpeg|gif|webp|svg))/i
      );
      if (rawImgMatch) image = pickBestImage(targetUrl, [rawImgMatch[1]]);
    }
  } else {
    // Parsing para formato HTML (AllOrigins)
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const getMeta = (names: string[]) => {
      for (const name of names) {
        const el = doc.querySelector(
          `meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`
        );
        const content = el?.getAttribute("content");
        if (content) return content;
      }
      return null;
    };

    title =
      getMeta(["og:title", "twitter:title", "title"]) ||
      doc.querySelector("title")?.innerText ||
      "Enlace Guardado";
    title = title.split(" - ")[0].split(" | ")[0].trim();

    const metaImage = getMeta([
      "og:image",
      "og:image:url",
      "og:image:secure_url",
      "twitter:image",
      "image",
      "thumbnailUrl",
    ]);

    const metaCandidates: string[] = [];
    if (metaImage) metaCandidates.push(metaImage);

    const bodyCandidates: string[] = [];
    const imgNodes = Array.from(
      doc.querySelectorAll(
        "article img, main img, .content img, #content img, img"
      )
    ).slice(0, 40);

    for (const img of imgNodes) {
      const src =
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original") ||
        null;
      const srcsetLargest = parseSrcsetLargest(img.getAttribute("srcset"));
      if (src) bodyCandidates.push(src);
      if (srcsetLargest) bodyCandidates.push(srcsetLargest);
    }

    // Prefer meta image even if it's hosted externally (common for embeds/CDNs)
    image = pickBestImage(targetUrl, metaCandidates, {
      allowExternalHosts: true,
    });
    if (!image) {
      image = pickBestImage(targetUrl, bodyCandidates);
    }
  }

  // 4. Normalización de URLs de imagen
  if (image && !image.startsWith("http")) {
    try {
      const base = new URL(targetUrl);
      if (image.startsWith("//")) {
        image = `${base.protocol}${image}`;
      } else if (image.startsWith("/")) {
        image = `${base.origin}${image}`;
      } else {
        image = `${base.origin}/${image}`;
      }
    } catch (e) {
      image = undefined;
    }
  }

  if (image && !isLikelyImageUrl(image)) {
    image = undefined;
  }

  return {
    title: title.length > 150 ? title.substring(0, 147) + "..." : title,
    image: image || undefined,
    url: targetUrl,
  };
};

export const formatRelativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days === 0) {
    if (hours === 0) {
      if (minutes === 0) return "Ahora";
      return `Hace ${minutes} min`;
    }
    return `Hace ${hours} h`;
  }
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} d`;
  return new Date(timestamp).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
};

export const getDomain = (url: string): string => {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = parsed.hostname.replace("www.", "").split(".");
    // Retornar el nombre del dominio principal en mayúsculas
    return (
      parts.length > 1 ? parts[parts.length - 2] : parts[0]
    ).toUpperCase();
  } catch {
    return "LINK";
  }
};
