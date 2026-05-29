"use client";

/**
 * Mapa de negocios Bubui · vista geográfica.
 *
 * Carga Leaflet desde CDN client-side para evitar problemas de SSR y
 * no engordar el bundle del resto de la app. Tiles de OpenStreetMap
 * (sin API key). Pines rosa con el descuento del negocio sobre el icono.
 */

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

type Business = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  defaultDiscountPct: number;
  featured?: boolean;
  topInCategory?: boolean;
};

declare global {
  interface Window {
    L?: any;
  }
}

// Centro por defecto: plaza de Benalmádena Pueblo.
const DEFAULT_CENTER: [number, number] = [36.5949, -4.5747];

export default function MapaPage() {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [leafletReady, setLeafletReady] = useState(false);
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  // Embebido en la app nativa: ocultamos cabecera/footer/nav web (CSS).
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ReactNativeWebView) {
      document.body.classList.add("bubui-embedded");
    }
  }, []);

  // Carga datos de negocios con coordenadas.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/bubui/discover?limit=60");
        if (r.ok) {
          const j = await r.json();
          setItems((j.items ?? []).filter((b: Business) => b.latitude != null && b.longitude != null));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Inicializa el mapa cuando Leaflet está cargado y el div existe.
  useEffect(() => {
    if (!leafletReady || !mapDivRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;

    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView(DEFAULT_CENTER, 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    }).addTo(map);

    // Centrar en posición del usuario si nos lo permite (no bloquea).
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => map.setView([p.coords.latitude, p.coords.longitude], 15),
        () => {},
        { timeout: 4000 }
      );
    }

    mapRef.current = map;
  }, [leafletReady]);

  // Añade marcadores cuando llegan los datos y el mapa existe.
  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L;
    // Limpia marcadores anteriores
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (items.length === 0) return;

    const bounds: [number, number][] = [];
    items.forEach((b) => {
      if (b.latitude == null || b.longitude == null) return;
      const featured = !!b.featured;
      const size = featured ? 56 : 44;
      const height = featured ? 68 : 54;
      const grad = featured
        ? "linear-gradient(135deg,#F59E0B,#DB2777)"
        : "linear-gradient(135deg,#EC4899,#DB2777)";
      const shadow = featured
        ? "0 10px 22px -4px rgba(245,158,11,.55)"
        : "0 8px 16px -4px rgba(236,72,153,.5)";
      const crown = featured
        ? '<div style="position:absolute;top:-14px;left:0;right:0;text-align:center;font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25));">⭐</div>'
        : "";
      const icon = L.divIcon({
        className: "bubui-pin",
        html: `<div style="position:relative;width:${size}px;height:${height}px;">
          ${crown}
          <div style="position:absolute;inset:0;background:${grad};border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${shadow};${featured ? "outline:3px solid #fff;outline-offset:-3px;" : ""}"></div>
          <div style="position:absolute;top:${featured ? 8 : 6}px;left:0;right:0;text-align:center;color:#fff;font-weight:900;font-size:${featured ? 15 : 13}px;letter-spacing:-0.02em;">-${b.defaultDiscountPct}%</div>
        </div>`,
        iconSize: [size, height],
        iconAnchor: [size / 2, height],
        popupAnchor: [0, -height + 6]
      });
      const m = L.marker([b.latitude, b.longitude], { icon }).addTo(mapRef.current);
      const topBadge = b.topInCategory
        ? `<div style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 8px;border-radius:999px;background:linear-gradient(90deg,#FEF3C7,#FCE7F3);color:#92400E;font-size:10px;font-weight:800;border:1px solid #FCD34D;letter-spacing:0.02em;">🏆 Top en ${escapeHtml(b.category)}</div>`
        : "";
      m.bindPopup(
        `<div style="font-family:system-ui;min-width:160px;">
          <div style="font-weight:800;font-size:14px;color:#0A0A0A;">${escapeHtml(b.name)}</div>
          <div style="font-size:11px;color:rgba(0,0,0,.55);">${escapeHtml(b.category)} · ${escapeHtml(b.city)}</div>
          ${topBadge}
          <a href="/bubui/n/${encodeURIComponent(b.slug)}" style="display:inline-block;margin-top:8px;padding:6px 14px;border-radius:999px;background:linear-gradient(135deg,#EC4899,#DB2777);color:white;font-size:12px;font-weight:700;text-decoration:none;">Ver y canjear</a>
        </div>`
      );
      bounds.push([b.latitude, b.longitude]);
      markersRef.current.push(m);
    });

    if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 16);
    }
  }, [items, leafletReady]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletReady(true)}
      />
      <main className="max-w-md mx-auto pb-24">
        <div className="px-4 pt-6 pb-3">
          <span className="bubui-eyebrow">Mapa</span>
          <h1 className="text-2xl font-black tracking-tight mt-2">Negocios Bubui en el mapa</h1>
          <p className="text-black/55 text-xs mt-1">
            {loading ? "Cargando…" : items.length === 0 ? "Aún no hay negocios con ubicación en tu zona." : `${items.length} negocios cerca`}
          </p>
        </div>

        <div
          ref={mapDivRef}
          className="bubui-skeleton"
          style={{
            height: "65vh",
            margin: "0 16px",
            borderRadius: 20,
            overflow: "hidden"
          }}
        />

        <nav className="bubui-bottom-nav">
          <a href="/bubui/app">
            <span style={{ fontSize: 18 }}>🎟</span>
            <span>Cupones</span>
          </a>
          <a href="/bubui/app/descubre">
            <span style={{ fontSize: 18 }}>🧭</span>
            <span>Descubre</span>
          </a>
          <a href="/bubui/app/mapa" className="active">
            <span style={{ fontSize: 18 }}>🗺</span>
            <span>Mapa</span>
          </a>
          <a href="/bubui">
            <span style={{ fontSize: 18 }}>ℹ️</span>
            <span>Info</span>
          </a>
        </nav>
      </main>
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
