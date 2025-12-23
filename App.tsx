
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkItem } from './types';
import { fetchMetadata, getDomain, formatRelativeTime } from './services/metadataService';

const STORAGE_KEY = 'linkvault_storage_v1';
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop';

// Lista inicial vacía según solicitado
const INITIAL_LINKS: LinkItem[] = [];

const App: React.FC = () => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Cargar desde localStorage al inicio
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setLinks(parsed);
      } catch (e) {
        console.error("Error al cargar desde localStorage", e);
        setLinks(INITIAL_LINKS);
      }
    } else {
      setLinks(INITIAL_LINKS);
    }
  }, []);

  // Guardar en localStorage cada vez que cambia la lista (incluyendo vacíos)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  }, [links]);

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
   * Valida y normaliza la URL proporcionada.
   * Proporciona feedback descriptivo sobre errores comunes.
   */
  const validateUrl = (url: string): { error: string | null; normalized?: string } => {
    const trimmed = url.trim();
    if (!trimmed) return { error: "Por favor, ingresa una dirección web." };

    // Detectar espacios (error común al copiar/pegar)
    if (/\s/.test(trimmed)) {
      return { error: "La URL no puede contener espacios en blanco." };
    }

    // Detectar si falta el punto del dominio (ej: "google" en lugar de "google.com")
    if (!trimmed.includes('.')) {
      return { error: "Parece que falta la extensión del dominio (ej: .com, .es, .net)." };
    }

    // Normalizar el protocolo
    let normalized = trimmed;
    if (!/^[a-zA-Z]+:\/\//.test(trimmed)) {
      normalized = `https://${trimmed}`;
    }

    // Corregir errores de escritura comunes en el protocolo
    normalized = normalized.replace(/^htt[p]?s?:\/([^\/])/, 'https://$1');
    normalized = normalized.replace(/^htt[p]?s?:\/\/+/, 'https://');

    try {
      const urlObj = new URL(normalized);
      // Validar que tenga un hostname mínimo (evitar "https://.com")
      if (urlObj.hostname.length < 3 || !urlObj.hostname.includes('.')) {
        return { error: "El nombre de dominio parece estar incompleto." };
      }
      return { error: null, normalized: urlObj.toString() };
    } catch (e) {
      return { error: "La estructura del enlace es inválida. Revisa si hay caracteres extraños." };
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

    // Verificar duplicados usando la URL normalizada
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
      setError("No pudimos conectar con el sitio. Intenta con otra URL.");
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
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-xl shadow-lg shadow-primary/20">
              <span className="material-icons text-white block">link</span>
            </div>
            <h1 className="text-slate-900 dark:text-white text-xl font-extrabold tracking-tight hidden sm:block">LinkVault</h1>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                setIsDarkMode(!isDarkMode);
                document.documentElement.classList.toggle('dark');
              }}
              className="p-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-all active:scale-90"
            >
              <span className="material-icons block">{isDarkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300 hidden md:block">Mi Espacio</span>
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" className="w-8 h-8 rounded-full bg-slate-200 shadow-sm" alt="Avatar" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 md:py-12 flex flex-col gap-10">
        <section className="w-full max-w-2xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 md:p-8 shadow-2xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800"
          >
            <h2 className="text-slate-900 dark:text-white text-lg font-bold mb-5 flex items-center gap-2">
               <span className="material-icons text-primary">add_circle</span>
               Guardar nuevo recurso
            </h2>
            <div className="flex flex-col gap-4">
              <div className="relative">
                <input 
                  type="text"
                  className={`w-full rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 ${error ? 'border-red-400' : 'border-transparent dark:border-slate-800'} text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-14 pl-12 pr-4 transition-all outline-none text-sm md:text-base`}
                  placeholder="Pega tu enlace aquí (ej. google.com)..."
                  value={inputValue}
                  onChange={(e) => { setInputValue(e.target.value); setError(null); }}
                  onKeyPress={(e) => e.key === 'Enter' && agregarEnlace()}
                  disabled={isLoading}
                />
                <span className={`material-icons absolute left-4 top-1/2 -translate-y-1/2 ${error ? 'text-red-400' : 'text-slate-400'}`}>link</span>
              </div>
              
              <div className="relative">
                <input 
                  type="text"
                  className="w-full rounded-2xl bg-slate-50 dark:bg-slate-950 border-2 border-transparent dark:border-slate-800 text-slate-900 dark:text-white focus:ring-4 focus:ring-primary/10 focus:border-primary h-14 pl-12 pr-4 transition-all outline-none text-sm md:text-base"
                  placeholder="Etiquetas (diseño, web, curso)..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && agregarEnlace()}
                  disabled={isLoading}
                />
                <span className="material-icons absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">label</span>
              </div>

              <button 
                onClick={agregarEnlace}
                disabled={isLoading || !inputValue.trim()}
                className="h-14 w-full bg-primary hover:bg-primary/90 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-black rounded-2xl transition-all shadow-xl shadow-primary/30 flex items-center justify-center gap-3 active:scale-[0.98] mt-2 uppercase tracking-wider text-sm"
              >
                {isLoading ? (
                  <span className="animate-spin material-icons">sync</span>
                ) : (
                  <>
                    <span className="material-icons">auto_awesome</span>
                    <span>Agregar a Colección</span>
                  </>
                )}
              </button>
              
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 text-xs font-bold flex items-center gap-1 ml-1 mt-1">
                    <span className="material-icons text-sm">error</span> {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="material-icons text-primary text-3xl">auto_awesome</span>
              <h3 className="text-slate-900 dark:text-white text-2xl md:text-3xl font-black tracking-tight">Tu Colección</h3>
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2">
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-5 py-2 rounded-full text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${!selectedTag ? 'bg-primary text-white border-primary shadow-primary/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary'}`}
              >
                TODOS
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  className={`px-5 py-2 rounded-full text-[10px] font-black transition-all whitespace-nowrap shadow-sm border ${tag === selectedTag ? 'bg-primary text-white border-primary shadow-primary/30' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-primary'}`}
                >
                  #{tag.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            <AnimatePresence mode="popLayout">
              {filteredLinks.map((link) => (
                <motion.div 
                  key={link.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative flex flex-col bg-white dark:bg-slate-900 rounded-[2rem] overflow-hidden border border-slate-200 dark:border-slate-800 hover:border-primary/50 transition-all duration-300 hover:shadow-2xl shadow-slate-200/50 dark:hover:shadow-primary/5"
                >
                  <div 
                    className="relative aspect-video w-full bg-slate-100 dark:bg-slate-800 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
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

                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    
                    <button 
                      onClick={() => eliminarEnlace(link.id)}
                      className="absolute top-4 right-4 size-10 flex items-center justify-center bg-white/90 dark:bg-slate-900/90 text-slate-400 hover:text-red-500 rounded-full shadow-xl opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-90 z-10"
                    >
                      <span className="material-icons text-[20px]">delete</span>
                    </button>

                    <div className="absolute bottom-4 left-4 px-3 py-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-xl text-[10px] font-black text-primary border border-slate-200 dark:border-slate-700 uppercase tracking-widest shadow-lg">
                      {link.domain}
                    </div>
                  </div>

                  <div className="p-6 flex flex-col flex-1 gap-4">
                    <div className="flex flex-col gap-2">
                      <h4 className="text-slate-900 dark:text-white text-base md:text-lg font-extrabold leading-tight line-clamp-2 min-h-[3rem] group-hover:text-primary transition-colors">
                        {link.title}
                      </h4>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {link.tags.length > 0 ? (
                          link.tags.map(tag => (
                            <span key={tag} className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg font-bold uppercase tracking-tighter">
                              #{tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium italic">Sin tags</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {formatRelativeTime(link.timestamp)}
                      </span>
                      <a 
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary text-sm font-black hover:gap-3 transition-all group/btn"
                      >
                        ABRIR
                        <span className="material-icons text-[18px]">arrow_forward</span>
                      </a>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {filteredLinks.length === 0 && !isLoading && (
            <div className="py-32 flex flex-col items-center justify-center text-center">
              <span className="material-icons text-7xl text-slate-200 dark:text-slate-800 mb-4">inventory_2</span>
              <h4 className="text-slate-900 dark:text-white text-xl font-black mb-2 uppercase">Sin recursos</h4>
              <p className="text-slate-500 text-sm max-w-xs">Tu colección está lista para recibir nuevos enlaces.</p>
            </div>
          )}
        </section>
      </main>

      <footer className="py-12 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
          <p>© 2025 LinkVault | El poder de tus enlaces.</p>
          <div className="flex items-center gap-8">
            <a href="#" className="hover:text-primary transition-colors">Privacidad</a>
            <a href="#" className="hover:text-primary transition-colors">Soporte</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
