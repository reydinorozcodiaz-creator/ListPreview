import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LinkItem, MetadataResponse } from "./types";
import {
  fetchMetadata,
  getDomain,
  formatRelativeTime,
} from "./services/metadataService";

const STORAGE_KEY = "linkvault_storage_v1";
const TAG_STORAGE_KEY = "linkvault_selected_tag_v1";
const THEME_STORAGE_KEY = "linkvault_theme_v1";
const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop";

const PAGE_SIZE = 10;

const INITIAL_LINKS: LinkItem[] = [];

type SortMode = "recent" | "title_asc" | "domain_asc";

type CollectionView = "all" | "favorites" | "archived";

type StatusFilter = "all" | "unknown" | "ok" | "broken";

const generateId = () => {
  // Avoid deprecated substr
  return Math.random().toString(36).slice(2, 11);
};

const parseTagsInput = (value: string): string[] => {
  return value
    .split(/[ ,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
};

const ensureHttpUrl = (candidate: string): string => {
  const trimmed = (candidate || "").trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z]+:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const getDedupKey = (rawUrl: string): string => {
  const url = ensureHttpUrl(rawUrl);
  try {
    const u = new URL(url);
    u.hash = "";

    // Remove common tracking params
    const toDelete: string[] = [];
    u.searchParams.forEach((_, k) => {
      const key = k.toLowerCase();
      if (
        key.startsWith("utm_") ||
        key === "gclid" ||
        key === "fbclid" ||
        key === "igshid" ||
        key === "mc_cid" ||
        key === "mc_eid"
      ) {
        toDelete.push(k);
      }
    });
    toDelete.forEach((k) => u.searchParams.delete(k));

    u.pathname = u.pathname.replace(/\/+$/, "") || "/";

    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const query = u.search;
    return `${host}${path}${query}`;
  } catch {
    return (rawUrl || "").trim().toLowerCase();
  }
};

const mergeTwoLinks = (a: LinkItem, b: LinkItem): LinkItem => {
  const mergedTags = Array.from(
    new Set([...(a.tags || []), ...(b.tags || [])])
  );

  const aNotes = (a.notes || "").trim();
  const bNotes = (b.notes || "").trim();
  const mergedNotes =
    aNotes && bNotes && aNotes !== bNotes
      ? `${aNotes}\n\n---\n\n${bNotes}`
      : aNotes || bNotes;

  const aCount = a.openCount || 0;
  const bCount = b.openCount || 0;
  const lastOpenedAt =
    Math.max(a.lastOpenedAt || 0, b.lastOpenedAt || 0) || undefined;

  const statusRank = (s?: LinkItem["checkStatus"]) =>
    s === "broken" ? 2 : s === "ok" ? 1 : 0;
  const checkStatus =
    statusRank(a.checkStatus) >= statusRank(b.checkStatus)
      ? a.checkStatus
      : b.checkStatus;
  const lastCheckedAt =
    Math.max(a.lastCheckedAt || 0, b.lastCheckedAt || 0) || undefined;

  const rating =
    (Math.max(a.rating || 0, b.rating || 0) as 0 | 1 | 2 | 3 | 4 | 5) || 0;
  const prioOrder = { low: 0, medium: 1, high: 2 } as const;
  const aPrio = a.priority || "medium";
  const bPrio = b.priority || "medium";
  const priority = prioOrder[aPrio] >= prioOrder[bPrio] ? aPrio : bPrio;

  const aTitle = (a.title || "").trim();
  const bTitle = (b.title || "").trim();
  const title = bTitle.length > aTitle.length ? b.title : a.title;
  const image = a.image || b.image;

  return {
    ...a,
    title,
    image,
    tags: mergedTags,
    notes: mergedNotes,
    favorite: !!a.favorite || !!b.favorite,
    archived: !!a.archived && !!b.archived,
    openCount: aCount + bCount,
    lastOpenedAt,
    checkStatus: checkStatus || "unknown",
    lastCheckedAt,
    rating,
    priority,
  };
};

const mergeDuplicates = (items: LinkItem[]) => {
  const sorted = [...items].sort(
    (x, y) => (y.timestamp || 0) - (x.timestamp || 0)
  );
  const byKey = new Map<string, LinkItem>();
  let removed = 0;

  for (const link of sorted) {
    const key = getDedupKey(link.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, link);
    } else {
      byKey.set(key, mergeTwoLinks(existing, link));
      removed += 1;
    }
  }

  return { merged: Array.from(byKey.values()), removed };
};

const getFaviconUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    // Simple and very reliable favicon service
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
      parsed.hostname
    )}&sz=128`;
  } catch {
    return "";
  }
};

const normalizeImportedLink = (raw: any): LinkItem | null => {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.url !== "string" || raw.url.trim().length === 0) return null;

  let normalizedUrl = ensureHttpUrl(raw.url.trim());

  try {
    const urlObj = new URL(normalizedUrl);

    const title =
      typeof raw.title === "string" && raw.title.trim().length > 0
        ? raw.title.trim()
        : "Enlace Guardado";
    const tags = Array.isArray(raw.tags)
      ? raw.tags
          .filter((t: any) => typeof t === "string")
          .map((t: string) => t.trim().toLowerCase())
          .filter(Boolean)
      : typeof raw.tags === "string"
      ? parseTagsInput(raw.tags)
      : [];

    const imageCandidate =
      typeof raw.image === "string" ? raw.image.trim() : "";
    const looksLikeFavicon = imageCandidate.includes("google.com/s2/favicons");
    const image =
      (!looksLikeFavicon && imageCandidate ? imageCandidate : "") ||
      FALLBACK_IMAGE;

    const timestamp =
      typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : Date.now();

    const favorite = typeof raw.favorite === "boolean" ? raw.favorite : false;
    const archived = typeof raw.archived === "boolean" ? raw.archived : false;
    const notes = typeof raw.notes === "string" ? raw.notes : "";

    const ratingRaw = typeof raw.rating === "number" ? raw.rating : 0;
    const rating =
      ratingRaw === 0 ||
      ratingRaw === 1 ||
      ratingRaw === 2 ||
      ratingRaw === 3 ||
      ratingRaw === 4 ||
      ratingRaw === 5
        ? (ratingRaw as 0 | 1 | 2 | 3 | 4 | 5)
        : 0;

    const priorityRaw =
      typeof raw.priority === "string" ? raw.priority : "medium";
    const priority =
      priorityRaw === "low" ||
      priorityRaw === "medium" ||
      priorityRaw === "high"
        ? (priorityRaw as "low" | "medium" | "high")
        : "medium";
    const openCount =
      typeof raw.openCount === "number" && Number.isFinite(raw.openCount)
        ? raw.openCount
        : 0;
    const lastOpenedAt =
      typeof raw.lastOpenedAt === "number" && Number.isFinite(raw.lastOpenedAt)
        ? raw.lastOpenedAt
        : undefined;

    const checkStatusRaw =
      typeof raw.checkStatus === "string" ? raw.checkStatus : "unknown";
    const checkStatus =
      checkStatusRaw === "ok" ||
      checkStatusRaw === "broken" ||
      checkStatusRaw === "unknown"
        ? checkStatusRaw
        : "unknown";
    const lastCheckedAt =
      typeof raw.lastCheckedAt === "number" &&
      Number.isFinite(raw.lastCheckedAt)
        ? raw.lastCheckedAt
        : undefined;

    return {
      id:
        typeof raw.id === "string" && raw.id.trim().length > 0
          ? raw.id
          : generateId(),
      url: urlObj.toString(),
      title,
      image,
      domain: getDomain(urlObj.toString()),
      timestamp,
      tags,

      favorite,
      archived,
      notes,

      rating,
      priority,

      openCount,
      lastOpenedAt,

      checkStatus,
      lastCheckedAt,
    };
  } catch {
    return null;
  }
};

const App: React.FC = () => {
  // Inicialización perezosa (Lazy Initialization)
  const [links, setLinks] = useState<LinkItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return INITIAL_LINKS;
        return parsed.map(normalizeImportedLink).filter(Boolean) as LinkItem[];
      } catch (e) {
        return INITIAL_LINKS;
      }
    }
    return INITIAL_LINKS;
  });

  const [selectedTag, setSelectedTag] = useState<string | null>(() => {
    return localStorage.getItem(TAG_STORAGE_KEY);
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved !== null) return saved === "true";
    return document.documentElement.classList.contains("dark");
  });

  const [inputValue, setInputValue] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [domainFilter, setDomainFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [collectionView, setCollectionView] = useState<CollectionView>("all");

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastDeleted, setLastDeleted] = useState<{
    link: LinkItem;
    index: number;
    expiresAt: number;
  } | null>(null);

  const [lastMerged, setLastMerged] = useState<{
    removed: number;
    expiresAt: number;
  } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  const [preview, setPreview] = useState<MetadataResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRating, setEditRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">(
    "medium"
  );
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Sincronizar el tema visual con el sistema
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem(THEME_STORAGE_KEY, String(isDarkMode));
  }, [isDarkMode]);

  // Guardar cambios en la lista de enlaces
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  }, [links]);

  // Guardar cambios en el filtro de etiquetas
  useEffect(() => {
    if (selectedTag === null) {
      localStorage.removeItem(TAG_STORAGE_KEY);
    } else {
      localStorage.setItem(TAG_STORAGE_KEY, selectedTag);
    }
  }, [selectedTag]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    links.forEach((link) => link.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }, [links]);

  const allDomains = useMemo(() => {
    const domains = new Set<string>();
    links.forEach((l) => {
      if (l.domain) domains.add(l.domain);
    });
    return Array.from(domains).sort();
  }, [links]);

  useEffect(() => {
    if (!lastDeleted) return;
    const now = Date.now();
    const remaining = Math.max(0, lastDeleted.expiresAt - now);
    const timer = window.setTimeout(() => setLastDeleted(null), remaining);
    return () => window.clearTimeout(timer);
  }, [lastDeleted]);
  useEffect(() => {
    if (!lastMerged) return;
    const now = Date.now();
    const remaining = Math.max(0, lastMerged.expiresAt - now);
    const timer = window.setTimeout(() => setLastMerged(null), remaining);
    return () => window.clearTimeout(timer);
  }, [lastMerged]);
  const duplicatesCount = useMemo(() => {
    const counts = new Map<string, number>();
    links.forEach((l) => {
      const key = getDedupKey(l.url);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    let dups = 0;
    counts.forEach((n) => {
      if (n > 1) dups += n - 1;
    });
    return dups;
  }, [links]);

  // If selection mode is turned off, clear selection
  useEffect(() => {
    if (!isSelecting && selectedIds.size > 0) {
      setSelectedIds(new Set());
    }
  }, [isSelecting, selectedIds.size]);

  const filteredLinks = useMemo(() => {
    let result = links;

    // Collection views
    if (collectionView === "archived") {
      result = result.filter((l) => !!l.archived);
    } else {
      // Default: hide archived unless explicitly viewing them
      result = result.filter((l) => !l.archived);
      if (collectionView === "favorites") {
        result = result.filter((l) => !!l.favorite);
      }
    }

    if (selectedTag) {
      result = result.filter((link) => link.tags.includes(selectedTag));
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      // Simple query tokens: is:fav / is:arch
      const tokens = q.split(/\s+/g);
      const wantsFav =
        tokens.includes("is:fav") || tokens.includes("is:favorite");
      const wantsArch =
        tokens.includes("is:arch") || tokens.includes("is:archived");

      // domain:foo / tag:bar / status:broken
      const domainToken = tokens.find((t) => t.startsWith("domain:"));
      const tagToken = tokens.find((t) => t.startsWith("tag:"));
      const statusToken = tokens.find((t) => t.startsWith("status:"));

      const domainQuery = domainToken
        ? domainToken.replace(/^domain:/, "").toUpperCase()
        : "";
      const tagQuery = tagToken
        ? tagToken.replace(/^tag:/, "").toLowerCase()
        : "";
      const statusQuery = statusToken
        ? statusToken.replace(/^status:/, "")
        : "";

      if (wantsFav) result = result.filter((l) => !!l.favorite);
      if (wantsArch) result = result.filter((l) => !!l.archived);

      if (domainQuery) {
        result = result.filter((l) =>
          (l.domain || "").toUpperCase().includes(domainQuery)
        );
      }
      if (tagQuery) {
        result = result.filter((l) => (l.tags || []).includes(tagQuery));
      }
      if (
        statusQuery === "ok" ||
        statusQuery === "broken" ||
        statusQuery === "unknown"
      ) {
        result = result.filter(
          (l) => (l.checkStatus || "unknown") === statusQuery
        );
      }

      const cleaned = tokens
        .filter(
          (t) =>
            !t.startsWith("is:") &&
            !t.startsWith("domain:") &&
            !t.startsWith("tag:") &&
            !t.startsWith("status:")
        )
        .join(" ")
        .trim();

      result = result.filter((link) => {
        const haystack = [
          link.title,
          link.domain,
          link.url,
          ...(link.tags || []),
        ]
          .join(" ")
          .toLowerCase();
        return cleaned ? haystack.includes(cleaned) : true;
      });
    }

    if (domainFilter) {
      result = result.filter((l) => l.domain === domainFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter(
        (l) => (l.checkStatus || "unknown") === statusFilter
      );
    }

    result = [...result];
    if (sortMode === "recent") {
      result.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortMode === "title_asc") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === "domain_asc") {
      result.sort((a, b) => a.domain.localeCompare(b.domain));
    }

    return result;
  }, [
    links,
    selectedTag,
    searchQuery,
    sortMode,
    collectionView,
    domainFilter,
    statusFilter,
  ]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredLinks.length / PAGE_SIZE));
  }, [filteredLinks.length]);

  const pagedLinks = useMemo(() => {
    const safePage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredLinks.slice(start, start + PAGE_SIZE);
  }, [filteredLinks, currentPage, totalPages]);

  // Reset pagination when the visible set changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTag, searchQuery, sortMode, collectionView, links.length]);

  /**
   * Validación avanzada de URL con normalización inteligente
   */
  const validateUrl = (
    url: string
  ): { error: string | null; normalized?: string } => {
    const trimmed = url.trim();
    if (!trimmed) return { error: "Por favor, ingresa una dirección web." };

    if (/\s/.test(trimmed)) {
      return { error: "La URL no puede contener espacios en blanco." };
    }

    if (!trimmed.includes(".")) {
      return {
        error: "Parece que falta la extensión del dominio (ej: .com, .es).",
      };
    }

    let normalized = trimmed;
    if (!/^[a-zA-Z]+:\/\//.test(trimmed)) {
      normalized = `https://${trimmed}`;
    }

    normalized = normalized.replace(/^htt[p]?s?:\/([^\/])/, "https://$1");
    normalized = normalized.replace(/^htt[p]?s?:\/\/+/, "https://");

    try {
      const urlObj = new URL(normalized);
      if (urlObj.hostname.length < 3 || !urlObj.hostname.includes(".")) {
        return { error: "El nombre de dominio está incompleto." };
      }
      return { error: null, normalized: urlObj.toString() };
    } catch (e) {
      return { error: "La estructura del enlace es inválida." };
    }
  };

  // Debounced preview fetching as user types
  useEffect(() => {
    const raw = inputValue.trim();
    setPreviewError(null);
    setPreview(null);
    setPreviewUrl(null);

    if (!raw) {
      setIsPreviewLoading(false);
      return;
    }

    const { error: validationError, normalized } = validateUrl(raw);
    if (validationError || !normalized) {
      setIsPreviewLoading(false);
      return;
    }

    const finalUrl = normalized;
    if (links.some((l) => l.url.toLowerCase() === finalUrl.toLowerCase())) {
      setIsPreviewLoading(false);
      setPreviewError("Este enlace ya está en tu colección.");
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const data = await fetchMetadata(finalUrl);
        setPreview(data);
        setPreviewUrl(finalUrl);
      } catch {
        setPreviewError("No pudimos generar la vista previa.");
      } finally {
        setIsPreviewLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [inputValue, links]);

  const agregarEnlace = async () => {
    setError(null);
    const { error: validationError, normalized } = validateUrl(inputValue);

    if (validationError) {
      setError(validationError);
      return;
    }

    const finalUrl = normalized!;

    if (links.some((l) => l.url.toLowerCase() === finalUrl.toLowerCase())) {
      setError("Este enlace ya está en tu colección.");
      return;
    }

    const processedTags = parseTagsInput(tagInput);

    setIsLoading(true);
    try {
      const metadata =
        previewUrl === finalUrl && preview
          ? preview
          : await fetchMetadata(finalUrl);

      const newLink: LinkItem = {
        id: generateId(),
        url: finalUrl,
        title: metadata.title || "Nuevo Recurso",
        image: metadata.image || FALLBACK_IMAGE,
        domain: getDomain(finalUrl),
        timestamp: Date.now(),
        tags: processedTags,

        favorite: false,
        archived: false,
        notes: "",
        openCount: 0,
        lastOpenedAt: undefined,
        rating: 0,
        priority: "medium",
        checkStatus: "unknown",
        lastCheckedAt: undefined,
      };

      setLinks((prev) => [newLink, ...prev]);
      setInputValue("");
      setTagInput("");
      setPreview(null);
      setPreviewUrl(null);
      setPreviewError(null);
    } catch (err) {
      setError("No pudimos conectar con el sitio.");
    } finally {
      setIsLoading(false);
    }
  };

  const eliminarEnlace = (id: string) => {
    setLinks((prev) => {
      const index = prev.findIndex((l) => l.id === id);
      if (index === -1) return prev;
      const link = prev[index];
      setLastDeleted({ link, index, expiresAt: Date.now() + 6000 });
      const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
      return next;
    });
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    setLinks((prev) => {
      const exists = prev.some(
        (l) => l.url.toLowerCase() === lastDeleted.link.url.toLowerCase()
      );
      if (exists) return prev;
      const next = [...prev];
      const insertAt = Math.min(Math.max(lastDeleted.index, 0), next.length);
      next.splice(insertAt, 0, lastDeleted.link);
      return next;
    });
    setLastDeleted(null);
  };

  const toggleFavorite = (id: string) => {
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, favorite: !l.favorite } : l))
    );
  };

  const toggleArchived = (id: string) => {
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, archived: !l.archived } : l))
    );
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    ids.forEach((id) => eliminarEnlace(id));
    setIsSelecting(false);
  };

  const bulkArchive = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setLinks((prev) =>
      prev.map((l) => (selectedIds.has(l.id) ? { ...l, archived: true } : l))
    );
    setIsSelecting(false);
  };

  const bulkFavorite = (value: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setLinks((prev) =>
      prev.map((l) => (selectedIds.has(l.id) ? { ...l, favorite: value } : l))
    );
    setIsSelecting(false);
  };

  const getSafeImageUrl = (url: string) => {
    if (!url) return FALLBACK_IMAGE;
    return url.replace(/'/g, "\\'").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  };

  const exportLinks = () => {
    try {
      const blob = new Blob([JSON.stringify(links, null, 2)], {
        type: "application/json",
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `linkvault-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError("No pudimos exportar tus enlaces.");
    }
  };

  const importLinks = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setError("El archivo no contiene una lista válida.");
        return;
      }

      const incoming = parsed
        .map(normalizeImportedLink)
        .filter(Boolean) as LinkItem[];
      if (incoming.length === 0) {
        setError("No encontramos enlaces válidos para importar.");
        return;
      }

      setLinks((prev) => {
        const existingByUrl = new Set(prev.map((l) => l.url.toLowerCase()));
        const deduped = incoming.filter(
          (l) => !existingByUrl.has(l.url.toLowerCase())
        );
        return [...deduped, ...prev];
      });
    } catch {
      setError("No pudimos leer ese JSON.");
    }
  };

  const startEdit = (link: LinkItem) => {
    setEditingId(link.id);
    setEditTitle(link.title);
    setEditImage(link.image);
    setEditTags((link.tags || []).join(", "));
    setEditNotes(link.notes || "");
    setEditRating((link.rating ?? 0) as 0 | 1 | 2 | 3 | 4 | 5);
    setEditPriority((link.priority ?? "medium") as "low" | "medium" | "high");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditImage("");
    setEditTags("");
    setEditNotes("");
    setEditRating(0);
    setEditPriority("medium");
  };

  const saveEdit = (id: string) => {
    const title = editTitle.trim() || "Enlace Guardado";
    const tags = parseTagsInput(editTags);
    const image =
      (editImage.trim() || "").length > 0 ? editImage.trim() : FALLBACK_IMAGE;
    const notes = editNotes;
    const rating = editRating;
    const priority = editPriority;

    setLinks((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, title, tags, image, notes, rating, priority } : l
      )
    );
    cancelEdit();
  };

  const refreshMetadata = async (link: LinkItem) => {
    setRefreshingId(link.id);
    try {
      const data = await fetchMetadata(link.url);
      setLinks((prev) =>
        prev.map((l) => {
          if (l.id !== link.id) return l;
          const nextTitle = (data.title || l.title).trim();
          const nextImage = data.image || l.image || FALLBACK_IMAGE;
          return { ...l, title: nextTitle, image: nextImage };
        })
      );
    } catch {
      setError("No pudimos actualizar la vista previa.");
    } finally {
      setRefreshingId(null);
    }
  };

  const openLink = (rawUrl: string) => {
    const url = ensureHttpUrl(rawUrl);
    try {
      const validated = new URL(url);
      // Update stats
      setLinks((prev) =>
        prev.map((l) =>
          l.url.toLowerCase() === validated.toString().toLowerCase()
            ? {
                ...l,
                openCount: (l.openCount || 0) + 1,
                lastOpenedAt: Date.now(),
              }
            : l
        )
      );
      window.open(validated.toString(), "_blank", "noopener,noreferrer");
    } catch {
      setError("El enlace no es válido para abrir.");
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
      <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="bg-primary p-2 rounded-xl shadow-lg shadow-primary/20">
              <span className="material-icons text-white block text-[20px] md:text-[24px]">
                link
              </span>
            </div>
            <h1 className="text-slate-900 dark:text-white text-lg md:text-xl font-extrabold tracking-tight">
              LinkVault
            </h1>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importLinks(file);
                e.currentTarget.value = "";
              }}
            />
            {duplicatesCount > 0 && (
              <button
                onClick={() => {
                  const { merged, removed } = mergeDuplicates(links);
                  if (removed > 0) {
                    setLinks(merged);
                    setLastMerged({ removed, expiresAt: Date.now() + 6000 });
                  }
                }}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
                title={`Fusionar duplicados (${duplicatesCount})`}
              >
                <span className="material-icons block text-[22px] md:text-[24px]">
                  call_merge
                </span>
              </button>
            )}

            {/* Search UI is rendered below the header for all screen sizes */}

            {lastMerged && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(520px,calc(100%-2rem))]">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-4 py-3 shadow-xl">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                      Duplicados
                    </p>
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                      Fusionados {lastMerged.removed}
                    </p>
                  </div>
                  <button
                    onClick={() => setLastMerged(null)}
                    className="h-10 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 font-black text-xs transition-all"
                    title="Cerrar"
                  >
                    <span className="material-icons text-[18px]">close</span>
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => setIsSearchOpen((v) => !v)}
              className={`p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-90 ${
                isSearchOpen
                  ? "text-primary"
                  : "text-slate-600 dark:text-slate-400"
              }`}
              title="Buscar"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">
                search
              </span>
            </button>

            <button
              onClick={() => setIsSelecting((v) => !v)}
              className={`p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-90 ${
                isSelecting
                  ? "text-primary"
                  : "text-slate-600 dark:text-slate-400"
              }`}
              title="Seleccionar varios"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">
                select_all
              </span>
            </button>

            <button
              onClick={() => importInputRef.current?.click()}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
              title="Importar JSON"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">
                file_upload
              </span>
            </button>

            <button
              onClick={exportLinks}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
              title="Exportar JSON"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">
                file_download
              </span>
            </button>

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">
                {isDarkMode ? "light_mode" : "dark_mode"}
              </span>
            </button>
            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 pl-1 pr-1 md:pr-2 py-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <img
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-200 shadow-sm"
                alt="Avatar"
              />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300 hidden md:block">
                Mi Espacio
              </span>
            </div>
          </div>
        </div>

        {isSearchOpen && (
          <div className="border-t border-slate-200 dark:border-slate-800">
            <div className="max-w-7xl mx-auto px-4 py-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar… (ej: tag:react domain:google is:fav)"
                  className="w-full md:w-[28rem] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-11 pl-10 pr-10 transition-all outline-none text-sm"
                  autoFocus
                />
                <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  search
                </span>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setIsSearchOpen(false);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-all"
                  title="Cerrar búsqueda"
                >
                  <span className="material-icons text-[18px]">close</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 md:py-12 flex flex-col gap-6 md:gap-10">
        <section className="w-full max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-3xl p-5 md:p-8 shadow-xl md:shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800"
          >
            <h2 className="text-slate-900 dark:text-white text-base md:text-lg font-bold mb-4 md:mb-5 flex items-center gap-2">
              <span className="material-icons text-primary text-[20px] md:text-[24px]">
                add_circle
              </span>
              Guardar nuevo recurso
            </h2>
            <div className="flex flex-col gap-3 md:gap-4">
              <div className="relative">
                <input
                  type="text"
                  className={`w-full rounded-xl md:rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 ${
                    error
                      ? "border-red-400"
                      : "border-transparent dark:border-slate-800"
                  } text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-12 md:h-14 pl-10 md:pl-12 pr-4 transition-all outline-none text-sm md:text-base`}
                  placeholder="URL del enlace..."
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setError(null);
                  }}
                  onKeyPress={(e) => e.key === "Enter" && agregarEnlace()}
                  disabled={isLoading}
                />
                <span
                  className={`material-icons absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-[18px] md:text-[22px] ${
                    error ? "text-red-400" : "text-slate-400"
                  }`}
                >
                  link
                </span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  className="w-full rounded-xl md:rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-transparent dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-12 md:h-14 pl-10 md:pl-12 pr-4 transition-all outline-none text-sm md:text-base"
                  placeholder="Etiquetas (separadas por comas)..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && agregarEnlace()}
                  disabled={isLoading}
                />
                <span className="material-icons absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-[18px] md:text-[22px] text-slate-400">
                  label
                </span>
              </div>

              <button
                onClick={agregarEnlace}
                disabled={isLoading || isPreviewLoading || !inputValue.trim()}
                className="h-12 md:h-14 w-full bg-primary hover:bg-primary/90 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-black rounded-xl md:rounded-2xl transition-all shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-[0.98] mt-1 uppercase tracking-wider text-xs md:text-sm"
              >
                {isLoading || isPreviewLoading ? (
                  <span className="animate-spin material-icons text-[20px]">
                    sync
                  </span>
                ) : (
                  <>
                    <span className="material-icons text-[20px]">
                      auto_awesome
                    </span>
                    <span>Agregar a Colección</span>
                  </>
                )}
              </button>

              {(preview || previewError || isPreviewLoading) &&
                inputValue.trim() && (
                  <div className="mt-1 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-950">
                    <div className="flex gap-3 p-3 items-center">
                      <div
                        className="w-16 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 bg-cover bg-center flex-shrink-0"
                        style={{
                          backgroundImage: `url('${getSafeImageUrl(
                            preview?.image ||
                              (previewUrl ? getFaviconUrl(previewUrl) : "") ||
                              FALLBACK_IMAGE
                          )}')`,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Vista previa
                        </p>
                        <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                          {isPreviewLoading
                            ? "Cargando…"
                            : preview?.title || "Enlace"}
                        </p>
                        {previewError && (
                          <p className="text-[11px] font-bold text-red-500 mt-0.5">
                            {previewError}
                          </p>
                        )}
                      </div>
                      {previewUrl && (
                        <div className="text-[10px] font-black uppercase tracking-widest text-primary px-2 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                          {getDomain(previewUrl)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-500 text-[11px] md:text-xs font-bold flex items-center gap-1 ml-1"
                  >
                    <span className="material-icons text-sm">error</span>{" "}
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </section>

        <section className="flex flex-col gap-4 md:gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-icons text-primary text-2xl md:text-3xl">
                auto_awesome
              </span>
              <h3 className="text-slate-900 dark:text-white text-xl md:text-3xl font-black tracking-tight uppercase md:normal-case">
                Tu Colección
              </h3>
            </div>

            <div className="flex flex-col md:flex-row gap-2 md:gap-3">
              <div className="relative md:w-56">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="w-full rounded-xl md:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-11 md:h-12 pl-10 pr-4 transition-all outline-none text-sm appearance-none"
                >
                  <option value="recent">Más recientes</option>
                  <option value="title_asc">Título (A–Z)</option>
                  <option value="domain_asc">Dominio (A–Z)</option>
                </select>
                <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  sort
                </span>
                <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  expand_more
                </span>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-2 md:gap-3">
              <div className="relative flex-1">
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  className="w-full rounded-xl md:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-11 md:h-12 pl-10 pr-10 transition-all outline-none text-sm appearance-none"
                >
                  <option value="">Todos los dominios</option>
                  {allDomains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  language
                </span>
                <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  expand_more
                </span>
              </div>

              <div className="relative md:w-56">
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as StatusFilter)
                  }
                  className="w-full rounded-xl md:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-11 md:h-12 pl-10 pr-10 transition-all outline-none text-sm appearance-none"
                >
                  <option value="all">Estado: todos</option>
                  <option value="unknown">Estado: sin revisar</option>
                  <option value="ok">Estado: OK</option>
                  <option value="broken">Estado: roto</option>
                </select>
                <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  verified
                </span>
                <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                  expand_more
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 -mx-4 px-4 md:mx-0 md:px-0">
              <button
                onClick={() => setCollectionView("all")}
                className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${
                  collectionView === "all"
                    ? "bg-primary text-white border-primary shadow-primary/30"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary"
                }`}
              >
                TODOS
              </button>

              <button
                onClick={() => setCollectionView("favorites")}
                className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${
                  collectionView === "favorites"
                    ? "bg-primary text-white border-primary shadow-primary/30"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary"
                }`}
              >
                FAVORITOS
              </button>

              <button
                onClick={() => setCollectionView("archived")}
                className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${
                  collectionView === "archived"
                    ? "bg-primary text-white border-primary shadow-primary/30"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary"
                }`}
              >
                ARCHIVADOS
              </button>

              <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>

              <button
                onClick={() => setSelectedTag(null)}
                className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${
                  !selectedTag
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-700 dark:text-white dark:border-slate-700"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary"
                }`}
                title="Limpiar filtro de tags"
              >
                TAGS
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() =>
                    setSelectedTag(tag === selectedTag ? null : tag)
                  }
                  className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${
                    tag === selectedTag
                      ? "bg-primary text-white border-primary shadow-primary/30"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary"
                  }`}
                >
                  #{tag.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {isSelecting && selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                Seleccionados: {selectedIds.size}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bulkFavorite(true)}
                  className="h-10 px-4 rounded-xl bg-primary/10 text-primary hover:bg-primary/15 border border-primary/20 font-black text-xs transition-all"
                >
                  Favorito
                </button>
                <button
                  onClick={bulkArchive}
                  className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 font-black text-xs transition-all"
                >
                  Archivar
                </button>
                <button
                  onClick={bulkDelete}
                  className="h-10 px-4 rounded-xl bg-red-500/10 text-red-600 hover:bg-red-500/15 border border-red-500/20 font-black text-xs transition-all"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => {
                    clearSelection();
                    setIsSelecting(false);
                  }}
                  className="h-10 px-4 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 font-black text-xs transition-all"
                >
                  Salir
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
            <AnimatePresence mode="popLayout">
              {pagedLinks.map((link) => (
                <motion.div
                  key={link.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="group relative flex flex-col bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2rem] overflow-hidden border border-slate-200 dark:border-slate-800 hover:border-primary/50 transition-all duration-300 hover:shadow-xl shadow-slate-200/50 dark:hover:shadow-primary/5"
                >
                  <div
                    className="relative aspect-video w-full bg-slate-100 dark:bg-slate-800 bg-cover bg-center transition-transform duration-700 md:group-hover:scale-110"
                    style={{
                      backgroundImage: `url('${getSafeImageUrl(link.image)}')`,
                    }}
                  >
                    <button
                      onClick={() => toggleFavorite(link.id)}
                      className="absolute top-3 left-3 md:top-4 md:left-4 size-9 md:size-10 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-90 z-10"
                      title={
                        link.favorite
                          ? "Quitar de favoritos"
                          : "Marcar favorito"
                      }
                    >
                      <span
                        className={`material-icons text-[18px] md:text-[20px] ${
                          link.favorite
                            ? "text-amber-400"
                            : "text-slate-500 dark:text-slate-300"
                        }`}
                      >
                        star
                      </span>
                    </button>
                    <img
                      src={link.image}
                      className="hidden"
                      onError={(e) => {
                        const div = e.currentTarget.parentElement;
                        const img = e.currentTarget;
                        const fallback = FALLBACK_IMAGE;
                        img.dataset.stage = "fallback";
                        img.src = fallback;
                        if (div)
                          div.style.backgroundImage = `url('${getSafeImageUrl(
                            fallback
                          )}')`;
                      }}
                      data-stage="primary"
                    />

                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-transparent md:opacity-0 md:group-hover:opacity-100 transition-opacity"></div>

                    <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4 px-2 md:px-3 py-1 rounded-lg bg-black/35 text-[9px] md:text-[10px] font-black text-white uppercase tracking-widest drop-shadow">
                      {link.domain}
                    </div>
                  </div>

                  <div className="p-4 md:p-6 flex flex-col flex-1 gap-3 md:gap-4">
                    <div className="flex flex-col gap-1.5 md:gap-2">
                      {editingId === link.id ? (
                        <div className="flex flex-col gap-2">
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-10 px-3 transition-all outline-none text-sm font-bold"
                            placeholder="Título"
                          />
                          <input
                            value={editImage}
                            onChange={(e) => setEditImage(e.target.value)}
                            className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-10 px-3 transition-all outline-none text-sm"
                            placeholder="URL de la imagen (opcional)"
                          />
                          <input
                            value={editTags}
                            onChange={(e) => setEditTags(e.target.value)}
                            className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-10 px-3 transition-all outline-none text-sm"
                            placeholder="Tags (separados por comas)"
                          />

                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                Prioridad
                              </span>
                              <select
                                value={editPriority}
                                onChange={(e) =>
                                  setEditPriority(
                                    e.target.value as "low" | "medium" | "high"
                                  )
                                }
                                className="h-10 w-full sm:w-auto rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white px-3 text-sm outline-none"
                              >
                                <option value="low">Baja</option>
                                <option value="medium">Media</option>
                                <option value="high">Alta</option>
                              </select>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() =>
                                    setEditRating(n as 1 | 2 | 3 | 4 | 5)
                                  }
                                  className="p-1 active:scale-90 transition-transform"
                                  title={`Rating ${n}`}
                                >
                                  <span
                                    className={`material-icons text-[18px] ${
                                      editRating >= n
                                        ? "text-amber-400"
                                        : "text-slate-300 dark:text-slate-600"
                                    }`}
                                  >
                                    star
                                  </span>
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => setEditRating(0)}
                                className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                title="Quitar rating"
                              >
                                reset
                              </button>
                            </div>
                          </div>

                          <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="w-full rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary min-h-20 px-3 py-2 transition-all outline-none text-sm resize-none"
                            placeholder="Notas (opcional)"
                          />

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => saveEdit(link.id)}
                              className="flex-1 h-10 bg-primary hover:bg-primary/90 text-white font-black rounded-xl transition-all shadow-lg shadow-primary/20 active:scale-[0.98] text-xs uppercase tracking-wider"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex-1 h-10 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-black rounded-xl transition-all border border-slate-200 dark:border-slate-800 active:scale-[0.98] text-xs uppercase tracking-wider"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              isSelecting
                                ? toggleSelected(link.id)
                                : openLink(link.url)
                            }
                            className="text-left w-full flex items-start gap-2"
                            title={isSelecting ? "Seleccionar" : "Abrir"}
                          >
                            <img
                              src={getFaviconUrl(ensureHttpUrl(link.url))}
                              alt=""
                              className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                            <span className="text-slate-900 dark:text-white text-sm md:text-lg font-extrabold leading-tight line-clamp-2 md:min-h-[3rem] group-hover:text-primary transition-colors">
                              {link.title}
                            </span>
                          </button>
                          {/* Refactored tag container for better wrapping and spacing */}
                          <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mt-0.5">
                            {link.tags.length > 0 ? (
                              link.tags.map((tag) => (
                                <span
                                  key={tag}
                                  title={tag}
                                  className="inline-block text-[8px] md:text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-0.5 md:py-1 rounded-md md:rounded-lg font-bold uppercase tracking-tighter truncate max-w-[80px] md:max-w-[120px]"
                                >
                                  #{tag}
                                </span>
                              ))
                            ) : (
                              <span className="text-[8px] md:text-[10px] text-slate-400 font-medium italic">
                                Sin tags
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-3 md:pt-4 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSelecting && (
                          <button
                            onClick={() => toggleSelected(link.id)}
                            className={`size-8 rounded-full border flex items-center justify-center transition-all ${
                              selectedIds.has(link.id)
                                ? "bg-primary border-primary"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
                            }`}
                            title="Seleccionar"
                          >
                            <span
                              className={`material-icons text-[18px] ${
                                selectedIds.has(link.id)
                                  ? "text-white"
                                  : "text-slate-400"
                              }`}
                            >
                              check
                            </span>
                          </button>
                        )}

                        <span className="text-[9px] md:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest truncate">
                          {formatRelativeTime(link.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => refreshMetadata(link)}
                          disabled={refreshingId === link.id}
                          className="flex items-center justify-center size-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 hover:text-primary transition-all active:scale-90 disabled:opacity-60"
                          title="Actualizar vista previa"
                        >
                          <span
                            className={`material-icons text-[18px] ${
                              refreshingId === link.id ? "animate-spin" : ""
                            }`}
                          >
                            refresh
                          </span>
                        </button>

                        <button
                          onClick={() => toggleArchived(link.id)}
                          className="flex items-center justify-center size-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-all active:scale-90"
                          title={link.archived ? "Desarchivar" : "Archivar"}
                        >
                          <span className="material-icons text-[18px]">
                            archive
                          </span>
                        </button>

                        <button
                          onClick={() =>
                            editingId === link.id
                              ? cancelEdit()
                              : startEdit(link)
                          }
                          className="flex items-center justify-center size-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 hover:text-primary transition-all active:scale-90"
                          title="Editar"
                        >
                          <span className="material-icons text-[18px]">
                            edit
                          </span>
                        </button>

                        <button
                          onClick={() => eliminarEnlace(link.id)}
                          className="flex items-center justify-center size-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 hover:text-red-500 transition-all active:scale-90"
                          title="Eliminar"
                        >
                          <span className="material-icons text-[18px]">
                            delete
                          </span>
                        </button>

                        {/* Abrir se hace desde el título */}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {filteredLinks.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 pt-4 md:pt-6">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-2 rounded-full text-[10px] md:text-[11px] font-black transition-all whitespace-nowrap shadow-sm border bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary disabled:opacity-50 disabled:hover:border-slate-200 dark:disabled:hover:border-slate-700"
              >
                ANTERIOR
              </button>

              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 rounded-full text-[10px] md:text-[11px] font-black transition-all whitespace-nowrap shadow-sm border ${
                        page === currentPage
                          ? "bg-primary text-white border-primary shadow-primary/30"
                          : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary"
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}
              </div>

              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage >= totalPages}
                className="px-3 py-2 rounded-full text-[10px] md:text-[11px] font-black transition-all whitespace-nowrap shadow-sm border bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary disabled:opacity-50 disabled:hover:border-slate-200 dark:disabled:hover:border-slate-700"
              >
                SIGUIENTE
              </button>
            </div>
          )}

          {filteredLinks.length === 0 && !isLoading && (
            <div className="py-20 md:py-32 flex flex-col items-center justify-center text-center">
              <span className="material-icons text-5xl md:text-7xl text-slate-200 dark:text-slate-800 mb-3 md:mb-4">
                inventory_2
              </span>
              <h4 className="text-slate-900 dark:text-white text-base md:text-xl font-black mb-1 md:mb-2 uppercase">
                Sin recursos
              </h4>
              <p className="text-slate-500 text-xs max-w-[200px] md:max-w-xs">
                No hay resultados para el filtro actual.
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="py-8 md:py-12 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6 text-slate-400 text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-center">
          <p>© 2025 LinkVault | El poder de tus enlaces.</p>
          <div className="flex items-center gap-6 md:gap-8">
            <a href="#" className="hover:text-primary transition-colors">
              Privacidad
            </a>
            <a href="#" className="hover:text-primary transition-colors">
              Soporte
            </a>
          </div>
        </div>
      </footer>

      {lastDeleted && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(520px,calc(100%-2rem))]">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-4 py-3 shadow-xl">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                Eliminado
              </p>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                {lastDeleted.link.title}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={undoDelete}
                className="h-10 px-4 rounded-xl bg-primary/10 text-primary hover:bg-primary/15 border border-primary/20 font-black text-xs transition-all"
              >
                Deshacer
              </button>
              <button
                onClick={() => setLastDeleted(null)}
                className="h-10 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 font-black text-xs transition-all"
                title="Cerrar"
              >
                <span className="material-icons text-[18px]">close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
