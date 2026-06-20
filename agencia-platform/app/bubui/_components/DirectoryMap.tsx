"use client";

/**
 * Mapa del directorio con los negocios que tienen coordenadas. Carga Leaflet
 * + OpenStreetMap desde CDN (sin dependencias npm ni API key). Si ningún
 * negocio tiene coordenadas, no renderiza nada.
 */
import { useEffect, useRef } from "react";

type Pin = { name: string; slug: string; lat: number; lng: number };

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function ensureLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    let script = document.querySelector(`script[src="${LEAFLET_JS}"]`) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener("load", () => resolve((window as any).L));
    script.addEventListener("error", reject);
    if (w.L) resolve(w.L);
  });
}

export default function DirectoryMap({ pins }: { pins: Pin[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || pins.length === 0) return;
    let cancelled = false;
    ensureLeaflet()
      .then((L) => {
        if (cancelled || !ref.current || mapRef.current) return;
        const map = L.map(ref.current, { scrollWheelZoom: false });
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 19
        }).addTo(map);
        const markers = pins.map((p) =>
          L.marker([p.lat, p.lng]).bindPopup(`<strong>${escapeHtml(p.name)}</strong><br/><a href="/n/${encodeURIComponent(p.slug)}">Ver ficha</a>`)
        );
        const group = L.featureGroup(markers).addTo(map);
        map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 16 });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [pins]);

  if (pins.length === 0) return null;
  return <div ref={ref} className="h-72 w-full rounded-2xl overflow-hidden border border-slate-200 z-0" aria-label="Mapa de negocios" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
