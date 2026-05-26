"use client";

/**
 * Preferencia personal (per-usuario y per-navegador) de qué pestañas /
 * secciones del Sidebar quiere ocultar el usuario. Se persiste en
 * localStorage, igual que el orden de proyectos/plataformas del sidebar.
 *
 * Las claves son los `href` de las pestañas principales (p.ej. "/tareas")
 * y identificadores "section:..." para secciones (Proyectos, Plataformas)
 * y "facturacion" para la sección de Facturación.
 */

const KEY = "hub-hidden-nav-v1";
const EVENT = "hub-hidden-nav-changed";

export function readHiddenNav(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenNav(items: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
  // Notifica a otras pestañas (storage event nativo) y al propio tab
  // (custom event, porque "storage" no dispara en la pestaña que escribe).
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

/** Suscribe un callback a cambios en la preferencia (en este tab y entre
 *  pestañas). Devuelve la función para desuscribirse. */
export function subscribeHiddenNav(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}
