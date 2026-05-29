"use client";

/**
 * Descubre — feed público de negocios Bubui cerca (estilo "Feed Cliente").
 * Buscador + chips con icono + photo cards con corazón de favorito
 * (persistido en localStorage). Usa /api/bubui/discover.
 */

import { useEffect, useState } from "react";

type Business = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string;
  address: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  defaultDiscountPct: number;
  distanceM: number | null;
  topInCategory?: boolean;
};

const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "Todo", label: "Todos", icon: "✨" },
  { key: "Restauración", label: "Restaurantes", icon: "🍴" },
  { key: "Café / Bar", label: "Cafeterías", icon: "☕" },
  { key: "Belleza", label: "Belleza", icon: "💅" },
  { key: "Tiendas", label: "Tiendas", icon: "🛍" },
  { key: "Fitness", label: "Fitness", icon: "💪" }
];

const FAVS_KEY = "bubui.favs";

export default function DescubrePage() {
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVS_KEY);
      if (raw) setFavs(JSON.parse(raw));
    } catch {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {},
        { timeout: 5000 }
      );
    }
  }, []);

  function toggleFav(slug: string) {
    setFavs((prev) => {
      const next = prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug];
      try { localStorage.setItem(FAVS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = new URL("/api/bubui/discover", window.location.origin);
      if (coords) {
        url.searchParams.set("lat", String(coords.lat));
        url.searchParams.set("lng", String(coords.lng));
      }
      try {
        const r = await fetch(url.toString());
        if (r.ok) setItems((await r.json()).items ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [coords]);

  const filtered = items.filter((b) => {
    if (category !== "Todo" && !b.category?.toLowerCase().includes(category.toLowerCase().split(" ")[0])) return false;
    if (query.trim() && !`${b.name} ${b.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <main className="max-w-md mx-auto px-4 py-6 pb-24">
      <div className="mb-4 bubui-fade-up">
        <h1 className="text-2xl font-black tracking-tight leading-tight">Descubre y ahorra<br />cerca de ti</h1>
      </div>

      <div className="bubui-search bubui-fade-up bubui-fade-up-1 mb-3">
        <span aria-hidden>🔍</span>
        <input
          type="search"
          placeholder="Buscar negocios, comida, belleza…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="bubui-chips bubui-fade-up bubui-fade-up-2 mb-4">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={"bubui-chip" + (category === c.key ? " active" : "")}
          >
            <span className="mr-1" aria-hidden>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-black">Cerca de ti</h2>
        <a href="/bubui/app/mapa" className="text-xs font-bold text-pink-600 hover:underline">Ver mapa →</a>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="bubui-skeleton h-44" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bubui-card p-6 text-center text-sm text-black/60">
          {items.length === 0
            ? "Aún no hay negocios en tu zona. Estamos en piloto en Benalmádena."
            : "Sin resultados para tu filtro."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b, i) => {
            const fav = favs.includes(b.slug);
            return (
              <div key={b.id} className={"relative bubui-fade-up " + (i < 4 ? `bubui-fade-up-${i + 1}` : "")}>
                <button
                  onClick={() => toggleFav(b.slug)}
                  aria-label={fav ? "Quitar de favoritos" : "Guardar"}
                  className="absolute top-3 left-3 z-10 h-9 w-9 grid place-items-center rounded-full bg-white/90 backdrop-blur shadow text-lg"
                >
                  {fav ? "❤️" : "🤍"}
                </button>
                <a href={`/bubui/n/${b.slug}`} className="block bubui-photo-card">
                  <div
                    className="photo"
                    style={
                      b.logoUrl
                        ? { background: `center/cover no-repeat url(${b.logoUrl})` }
                        : b.brandColor
                        ? { background: b.brandColor }
                        : undefined
                    }
                  >
                    <div className="discount-tag">-{b.defaultDiscountPct}%</div>
                  </div>
                  <div className="body">
                    <div className="name truncate flex items-center gap-1">
                      <span className="truncate">{b.name}</span>
                      {b.topInCategory && (
                        <span title={`Top en ${b.category}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap shrink-0">
                          🏆 Top
                        </span>
                      )}
                    </div>
                    <div className="meta truncate">
                      {b.category}
                      {b.distanceM != null &&
                        ` · ${b.distanceM > 1000 ? `${(b.distanceM / 1000).toFixed(1)} km` : `${b.distanceM} m`}`}
                    </div>
                  </div>
                </a>
              </div>
            );
          })}
        </div>
      )}

      <nav className="bubui-bottom-nav">
        <a href="/bubui/app">
          <span style={{ fontSize: 18 }}>🏠</span>
          <span>Inicio</span>
        </a>
        <a href="/bubui/app/descubre" className="active">
          <span style={{ fontSize: 18 }}>🧭</span>
          <span>Descubre</span>
        </a>
        <a href="/bubui/app/mapa">
          <span style={{ fontSize: 18 }}>🗺</span>
          <span>Mapa</span>
        </a>
        <a href="/bubui">
          <span style={{ fontSize: 18 }}>ℹ️</span>
          <span>Info</span>
        </a>
      </nav>
    </main>
  );
}
