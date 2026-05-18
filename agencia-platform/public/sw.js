// Service worker de Agencia Hub.
//
// Funciones:
//  1. Notificaciones push (web-push) — el original.
//  2. Cache del shell (HTML, JS, CSS, iconos) para que la app
//     abra sin red. Estrategia: network-first con fallback al
//     cache; los assets de _next/static se cachean cache-first
//     porque son inmutables.
//  3. Caché de respuestas GET de la API recientes (stale-while-
//     revalidate) para que /mi-dia y /tareas muestren la última
//     vista vista al perder conexión.
//  4. Queue de mutaciones offline. PATCH/POST/DELETE a la API
//     que fallen por red se guardan en IndexedDB y se reintentan
//     cuando vuelve la conexión.
//
// VERSION: bump esto en CADA cambio de UI que el user deba ver al
// instante (no esperar al ciclo natural de invalidación). El install
// activa skipWaiting y el activate borra todas las caches con
// VERSION != actual. Subir el número aquí FUERZA a todos los
// navegadores con la PWA cacheada a re-descargar todo.

const VERSION = "v7-2026-05-18b";
const SHELL_CACHE = `hub-shell-${VERSION}`;
const API_CACHE = `hub-api-${VERSION}`;

// Recursos cacheables al instalar.
const SHELL_URLS = [
  "/",
  "/mi-dia",
  "/tareas",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_URLS).catch(() => {})) // si alguno falla, seguimos
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Borra caches de versiones anteriores
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo nuestro origen
  if (url.origin !== self.location.origin) return;

  // GETs
  if (req.method === "GET") {
    // Assets inmutables de Next: cache-first.
    if (url.pathname.startsWith("/_next/static")) {
      event.respondWith(cacheFirst(req, SHELL_CACHE));
      return;
    }
    // API: stale-while-revalidate (sirve lo cacheado y refresca
    // en background). Si falla la red y no hay cache, 503 JSON.
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(staleWhileRevalidate(req, API_CACHE));
      return;
    }
    // HTML páginas: network-first, fallback cache.
    if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
      event.respondWith(networkFirst(req, SHELL_CACHE));
      return;
    }
  }

  // Mutaciones (POST/PATCH/DELETE/PUT): si la red falla, encolamos.
  if (["POST", "PATCH", "DELETE", "PUT"].includes(req.method) && url.pathname.startsWith("/api/")) {
    event.respondWith(networkOrQueue(req));
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response("offline", { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Fallback genérico para navegaciones sin caché.
    return (
      (await cache.match("/")) ||
      new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return (
    cached ||
    (await refresh) ||
    new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    })
  );
}

async function networkOrQueue(req) {
  try {
    return await fetch(req.clone());
  } catch {
    // Sin red. Guardamos en queue para reintentar.
    await enqueueRequest(req);
    // Avisar a las ventanas activas de que hay una mutación pendiente.
    broadcast({ type: "queued", url: req.url, method: req.method });
    return new Response(
      JSON.stringify({ ok: true, queued: true, message: "Sin conexión: guardado para sincronizar" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ---- IndexedDB queue ----
// Mantenemos una store sencilla "outbox" con las requests pendientes.
// Cuando 'online' vuelve, las reintentamos en orden.

const DB_NAME = "hub-outbox-v1";
const STORE = "requests";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueRequest(req) {
  const db = await openDb();
  const body = await req.clone().text();
  const headers = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({
      url: req.url,
      method: req.method,
      headers,
      body,
      ts: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushQueue() {
  const db = await openDb();
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (const item of all) {
    try {
      const r = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body
      });
      if (r.ok || r.status < 500) {
        // Éxito o error definitivo del cliente (400/404/...). Quitar
        // de la queue: reintentar 400 indefinidamente no va a arreglarlo.
        await new Promise((resolve) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(item.id);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        broadcast({ type: "flushed", url: item.url, ok: r.ok, status: r.status });
      }
    } catch {
      // Red sigue caída. Lo dejamos para el siguiente intento.
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "FLUSH_QUEUE") flushQueue();
});

self.addEventListener("sync", (event) => {
  if (event.tag === "flush-outbox") event.waitUntil(flushQueue());
});

function broadcast(msg) {
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientsArr) => clientsArr.forEach((c) => c.postMessage(msg)));
}

// ---- Push (mantenido del SW original) ----

self.addEventListener("push", (event) => {
  let data = { title: "Agencia Hub", body: "Tienes una notificación nueva", link: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no JSON
  }
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { link: data.link ?? "/" },
    tag: data.tag ?? undefined
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const url = new URL(target, self.location.origin).href;
      for (const c of clientsArr) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) c.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
