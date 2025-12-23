
import { MetadataResponse } from '../types';

/**
 * Obtiene metadatos de una URL utilizando AllOrigins con un fallback a r.jina.ai
 * para saltar bloqueos agresivos (Cloudflare, 403, etc).
 */
export const fetchMetadata = async (url: string): Promise<MetadataResponse> => {
  const targetUrl = url.startsWith('http') ? url : `https://${url}`;
  let html = '';
  let isMarkdown = false;

  // 1. Intento con AllOrigins (Proxy HTML)
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&_=${Date.now()}`;
    const response = await fetch(proxyUrl);
    if (response.ok) {
      html = await response.text();
      // Verificación de bloqueos comunes
      const forbidden = html.toLowerCase().includes('forbidden') || html.toLowerCase().includes('403 forbidden');
      const cloudflare = html.includes('cf-browser-verification') || html.includes('cloudflare');
      if (forbidden || cloudflare || html.length < 600) {
        html = ''; 
      }
    }
  } catch (e) {
    console.warn('AllOrigins falló o fue bloqueado.');
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
      console.error('Proxy r.jina.ai también falló.');
    }
  }

  if (!html) {
    return { title: 'Enlace Guardado', url: targetUrl };
  }

  // 3. Extracción de datos
  let title = 'Enlace Guardado';
  let image = undefined;

  if (isMarkdown) {
    // Parsing para formato Markdown (Jina)
    const titleMatch = html.match(/^Title:\s*(.*)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    // Búsqueda de imágenes en Markdown (patrón ![alt](url))
    const imgMatches = [...html.matchAll(/!\[.*?\]\((https?:\/\/.*?)\)/g)];
    if (imgMatches.length > 0) {
      // Intentamos evitar logos pequeños, buscamos la que parezca la principal
      image = imgMatches[0][1];
      // Si la primera imagen parece un avatar o icono, buscamos la siguiente
      if (image.toLowerCase().includes('avatar') || image.toLowerCase().includes('icon') || image.toLowerCase().includes('logo')) {
        if (imgMatches[1]) image = imgMatches[1][1];
      }
    } else {
      // Búsqueda cruda de URLs de imagen si el patrón falló
      const rawImgMatch = html.match(/(https?:\/\/.*?\.(?:png|jpg|jpeg|gif|webp|svg))/i);
      if (rawImgMatch) image = rawImgMatch[1];
    }
  } else {
    // Parsing para formato HTML (AllOrigins)
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const getMeta = (names: string[]) => {
      for (const name of names) {
        const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
        const content = el?.getAttribute('content');
        if (content) return content;
      }
      return null;
    };

    title = getMeta(['og:title', 'twitter:title', 'title']) || doc.querySelector('title')?.innerText || 'Enlace Guardado';
    title = title.split(' - ')[0].split(' | ')[0].trim();

    image = getMeta(['og:image', 'og:image:url', 'twitter:image', 'image', 'thumbnailUrl']);

    if (!image) {
      // Intentar buscar en etiquetas img del cuerpo si no hay metatags
      const mainImg = doc.querySelector('article img, main img, .content img, #content img');
      image = mainImg?.getAttribute('src') || doc.querySelector('img')?.getAttribute('src') || null;
    }
  }

  // 4. Normalización de URLs de imagen
  if (image && !image.startsWith('http')) {
    try {
      const base = new URL(targetUrl);
      if (image.startsWith('//')) {
        image = `${base.protocol}${image}`;
      } else if (image.startsWith('/')) {
        image = `${base.origin}${image}`;
      } else {
        image = `${base.origin}/${image}`;
      }
    } catch (e) {
      image = undefined;
    }
  }

  return {
    title: title.length > 150 ? title.substring(0, 147) + '...' : title,
    image: image || undefined,
    url: targetUrl
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
      if (minutes === 0) return 'Ahora';
      return `Hace ${minutes} min`;
    }
    return `Hace ${hours} h`;
  }
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} d`;
  return new Date(timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

export const getDomain = (url: string): string => {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const parts = parsed.hostname.replace('www.', '').split('.');
    // Retornar el nombre del dominio principal en mayúsculas
    return (parts.length > 1 ? parts[parts.length - 2] : parts[0]).toUpperCase();
  } catch {
    return 'LINK';
  }
};
