"use client";

/**
 * Descubre — feed público de todos los negocios Bipi cerca.
 * Pensado para que el cliente vea la red antes de tener su primer cupón.
 *
 * Layout idéntico al feed de cupones (photo cards + buscador + chips)
 * pero usando /api/bipi/discover en vez de /api/bipi/offers.
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
};

const CATEGORIES = ["Todo", "Restauración", "Café / Bar", "Belleza", "Tiendas", "Fitness"];

export default function DescubrePage() {
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { timeout: 5000 }
    );
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = new URL("/api/bipi/discover", window.location.origin);
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
      <div className="mb-4 bipi-fade-up">
        <span className="bipi-eyebrow">Descubre</span>
        <h1 className="text-2xl font-black tracking-tight mt-3">Negocios Bipi cerca de ti</h1>
        <p className="text-black/55 text-sm mt-1">
          Escanea su QR para llevarte el descuento y desbloquear más cupones.
        </p>
      </div>

      <div className="bipi-search bipi-fade-up bipi-fade-up-1 mb-3">
        <span aria-hidden>🔍</span>
        <input
          type="search"
          placeholder="Buscar negocio o categoría…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="bipi-chips bipi-fade-up bipi-fade-up-2 mb-4">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={"bipi-chip" + (category === c ? " active" : "")}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bipi-skeleton h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bipi-card p-6 text-center text-sm text-black/60">
          {items.length === 0
            ? "Aún no hay negocios en tu zona. Estamos en piloto en Benalmádena."
            : "Sin resultados para tu filtro."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b, i) => (
            <a
              key={b.id}
              href={`/bipi/n/${b.slug}`}
              className={"block bipi-photo-card bipi-fade-up " + (i < 4 ? `bipi-fade-up-${i + 1}` : "")}
            >
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
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="name truncate">{b.name}</div>
                    <div className="meta truncate">
                      {b.category}
                      {b.distanceM != null &&
                        ` · ${b.distanceM > 1000 ? `${(b.distanceM / 1000).toFixed(1)} km` : `${b.distanceM} m`}`}
                    </div>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <nav className="bipi-bottom-nav">
        <a href="/bipi/app">
          <span style={{ fontSize: 18 }}>🎟</span>
          <span>Cupones</span>
        </a>
        <a href="/bipi/app/descubre" className="active">
          <span style={{ fontSize: 18 }}>🧭</span>
          <span>Descubre</span>
        </a>
        <a href="/bipi/app/mapa">
          <span style={{ fontSize: 18 }}>🗺</span>
          <span>Mapa</span>
        </a>
        <a href="/bipi">
          <span style={{ fontSize: 18 }}>ℹ️</span>
          <span>Info</span>
        </a>
      </nav>
    </main>
  );
}
