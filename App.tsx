
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkItem } from './types';
import { fetchMetadata, getDomain, formatRelativeTime } from './services/metadataService';

const STORAGE_KEY = 'linkvault_storage_v1';
const TAG_STORAGE_KEY = 'linkvault_selected_tag_v1';
const THEME_STORAGE_KEY = 'linkvault_theme_v1';
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop';

const INITIAL_LINKS: LinkItem[] = [];

const App: React.FC = () => {
  // Inicialización perezosa (Lazy Initialization)
  const [links, setLinks] = useState<LinkItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : INITIAL_LINKS;
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
    if (saved !== null) return saved === 'true';
    return document.documentElement.classList.contains('dark');
  });

  const [inputValue, setInputValue] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sincronizar el tema visual con el sistema
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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
    links.forEach(link => link.tags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [links]);

  const filteredLinks = useMemo(() => {
    if (!selectedTag) return links;
    return links.filter(link => link.tags.includes(selectedTag));
  }, [links, selectedTag]);

  /**
   * Validación avanzada de URL con normalización inteligente
   */
  const validateUrl = (url: string): { error: string | null; normalized?: string } => {
    const trimmed = url.trim();
    if (!trimmed) return { error: "Por favor, ingresa una dirección web." };

    if (/\s/.test(trimmed)) {
      return { error: "La URL no puede contener espacios en blanco." };
    }

    if (!trimmed.includes('.')) {
      return { error: "Parece que falta la extensión del dominio (ej: .com, .es)." };
    }

    let normalized = trimmed;
    if (!/^[a-zA-Z]+:\/\//.test(trimmed)) {
      normalized = `https://${trimmed}`;
    }

    normalized = normalized.replace(/^htt[p]?s?:\/([^\/])/, 'https://$1');
    normalized = normalized.replace(/^htt[p]?s?:\/\/+/, 'https://');

    try {
      const urlObj = new URL(normalized);
      if (urlObj.hostname.length < 3 || !urlObj.hostname.includes('.')) {
        return { error: "El nombre de dominio está incompleto." };
      }
      return { error: null, normalized: urlObj.toString() };
    } catch (e) {
      return { error: "La estructura del enlace es inválida." };
    }
  };

  const agregarEnlace = async () => {
    setError(null);
    const { error: validationError, normalized } = validateUrl(inputValue);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    const finalUrl = normalized!;

    if (links.some(l => l.url.toLowerCase() === finalUrl.toLowerCase())) {
      setError("Este enlace ya está en tu colección.");
      return;
    }

    const processedTags = tagInput.split(/[ ,]+/).map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

    setIsLoading(true);
    try {
      const metadata = await fetchMetadata(finalUrl);
      
      const newLink: LinkItem = {
        id: Math.random().toString(36).substr(2, 9),
        url: finalUrl,
        title: metadata.title || 'Nuevo Recurso',
        image: metadata.image || FALLBACK_IMAGE,
        domain: getDomain(finalUrl),
        timestamp: Date.now(),
        tags: processedTags
      };

      setLinks(prev => [newLink, ...prev]);
      setInputValue('');
      setTagInput('');
    } catch (err) {
      setError("No pudimos conectar con el sitio.");
    } finally {
      setIsLoading(false);
    }
  };

  const eliminarEnlace = (id: string) => {
    setLinks(prev => prev.filter(l => l.id !== id));
  };

  const getSafeImageUrl = (url: string) => {
    if (!url) return FALLBACK_IMAGE;
    return url.replace(/'/g, "\\'").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  };

  return (
    <div className="flex flex-col min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
      <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="bg-primary p-2 rounded-xl shadow-lg shadow-primary/20">
              <span className="material-icons text-white block text-[20px] md:text-[24px]">link</span>
            </div>
            <h1 className="text-slate-900 dark:text-white text-lg md:text-xl font-extrabold tracking-tight">LinkVault</h1>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
            >
              <span className="material-icons block text-[22px] md:text-[24px]">{isDarkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 pl-1 pr-1 md:pr-2 py-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-200 shadow-sm" alt="Avatar" />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300 hidden md:block">Mi Espacio</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 md:py-12 flex flex-col gap-6 md:gap-10">
        <section className="w-full max-w-2xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-3xl p-5 md:p-8 shadow-xl md:shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800"
          >
            <h2 className="text-slate-900 dark:text-white text-base md:text-lg font-bold mb-4 md:mb-5 flex items-center gap-2">
               <span className="material-icons text-primary text-[20px] md:text-[24px]">add_circle</span>
               Guardar nuevo recurso
            </h2>
            <div className="flex flex-col gap-3 md:gap-4">
              <div className="relative">
                <input 
                  type="text"
                  className={`w-full rounded-xl md:rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 ${error ? 'border-red-400' : 'border-transparent dark:border-slate-800'} text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-12 md:h-14 pl-10 md:pl-12 pr-4 transition-all outline-none text-sm md:text-base`}
                  placeholder="URL del enlace..."
                  value={inputValue}
                  onChange={(e) => { setInputValue(e.target.value); setError(null); }}
                  onKeyPress={(e) => e.key === 'Enter' && agregarEnlace()}
                  disabled={isLoading}
                />
                <span className={`material-icons absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-[18px] md:text-[22px] ${error ? 'text-red-400' : 'text-slate-400'}`}>link</span>
              </div>
              
              <div className="relative">
                <input 
                  type="text"
                  className="w-full rounded-xl md:rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-transparent dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-12 md:h-14 pl-10 md:pl-12 pr-4 transition-all outline-none text-sm md:text-base"
                  placeholder="Etiquetas (separadas por comas)..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && agregarEnlace()}
                  disabled={isLoading}
                />
                <span className="material-icons absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-[18px] md:text-[22px] text-slate-400">label</span>
              </div>

              <button 
                onClick={agregarEnlace}
                disabled={isLoading || !inputValue.trim()}
                className="h-12 md:h-14 w-full bg-primary hover:bg-primary/90 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-black rounded-xl md:rounded-2xl transition-all shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-[0.98] mt-1 uppercase tracking-wider text-xs md:text-sm"
              >
                {isLoading ? (
                  <span className="animate-spin material-icons text-[20px]">sync</span>
                ) : (
                  <>
                    <span className="material-icons text-[20px]">auto_awesome</span>
                    <span>Agregar a Colección</span>
                  </>
                )}
              </button>
              
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 text-[11px] md:text-xs font-bold flex items-center gap-1 ml-1">
                    <span className="material-icons text-sm">error</span> {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </section>

        <section className="flex flex-col gap-4 md:gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="material-icons text-primary text-2xl md:text-3xl">auto_awesome</span>
              <h3 className="text-slate-900 dark:text-white text-xl md:text-3xl font-black tracking-tight uppercase md:normal-case">Tu Colección</h3>
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 -mx-4 px-4 md:mx-0 md:px-0">
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${!selectedTag ? 'bg-primary text-white border-primary shadow-primary/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary'}`}
              >
                TODOS
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  className={`px-4 py-2 rounded-full text-[9px] md:text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${tag === selectedTag ? 'bg-primary text-white border-primary shadow-primary/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary'}`}
                >
                  #{tag.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
            <AnimatePresence mode="popLayout">
              {filteredLinks.map((link) => (
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
                    style={{ backgroundImage: `url('${getSafeImageUrl(link.image)}')` }}
                  >
                    <img 
                      src={link.image} 
                      className="hidden" 
                      onError={(e) => {
                        const div = e.currentTarget.parentElement;
                        if (div) div.style.backgroundImage = `url('${FALLBACK_IMAGE}')`;
                      }} 
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent md:opacity-0 md:group-hover:opacity-100 transition-opacity"></div>
                    
                    <button 
                      onClick={() => eliminarEnlace(link.id)}
                      className="absolute top-3 right-3 md:top-4 md:right-4 size-9 md:size-10 flex items-center justify-center bg-white/90 dark:bg-slate-900/90 text-slate-400 hover:text-red-500 rounded-full shadow-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all hover:scale-110 active:scale-90 z-10"
                    >
                      <span className="material-icons text-[18px] md:text-[20px]">delete</span>
                    </button>

                    <div className="absolute bottom-3 left-3 md:bottom-4 md:left-4 px-2 md:px-3 py-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-black text-primary border border-slate-200 dark:border-slate-700 uppercase tracking-widest shadow-lg">
                      {link.domain}
                    </div>
                  </div>

                  <div className="p-4 md:p-6 flex flex-col flex-1 gap-3 md:gap-4">
                    <div className="flex flex-col gap-1.5 md:gap-2">
                      <h4 className="text-slate-900 dark:text-white text-sm md:text-lg font-extrabold leading-tight line-clamp-2 md:min-h-[3rem] group-hover:text-primary transition-colors">
                        {link.title}
                      </h4>
                      {/* Refactored tag container for better wrapping and spacing */}
                      <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mt-0.5">
                        {link.tags.length > 0 ? (
                          link.tags.map(tag => (
                            <span 
                              key={tag} 
                              title={tag}
                              className="inline-block text-[8px] md:text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2.5 py-0.5 md:py-1 rounded-md md:rounded-lg font-bold uppercase tracking-tighter truncate max-w-[80px] md:max-w-[120px]"
                            >
                              #{tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-[8px] md:text-[10px] text-slate-400 font-medium italic">Sin tags</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-3 md:pt-4 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {formatRelativeTime(link.timestamp)}
                      </span>
                      <a 
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary text-[11px] md:text-sm font-black hover:gap-2 md:hover:gap-3 transition-all"
                      >
                        ABRIR
                        <span className="material-icons text-[16px] md:text-[18px]">arrow_forward</span>
                      </a>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {filteredLinks.length === 0 && !isLoading && (
            <div className="py-20 md:py-32 flex flex-col items-center justify-center text-center">
              <span className="material-icons text-5xl md:text-7xl text-slate-200 dark:text-slate-800 mb-3 md:mb-4">inventory_2</span>
              <h4 className="text-slate-900 dark:text-white text-base md:text-xl font-black mb-1 md:mb-2 uppercase">Sin recursos</h4>
              <p className="text-slate-500 text-xs max-w-[200px] md:max-w-xs">Tu colección está lista para recibir nuevos enlaces.</p>
            </div>
          )}
        </section>
      </main>

      <footer className="py-8 md:py-12 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6 text-slate-400 text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-center">
          <p>© 2025 LinkVault | El poder de tus enlaces.</p>
          <div className="flex items-center gap-6 md:gap-8">
            <a href="#" className="hover:text-primary transition-colors">Privacidad</a>
            <a href="#" className="hover:text-primary transition-colors">Soporte</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
