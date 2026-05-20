// Service worker de Agencia Hub.
//
// ⚠️ ESTA VERSIÓN ESTÁ MUY ADELGAZADA RESPECTO A LA ANTERIOR ⚠️
//
// El SW anterior (v2-v8) cacheaba /_next/static/* con cache-first
// y HTML con network-first. Resultado: en el navegador del user
// quedaba un SW antiguo sirviendo CHUNKS JS viejos durante semanas,
// y mis fixes nuevos nunca se veían aunque Railway deployara bien.
// Bump de VERSION + skipWaiting NO arregló esto porque la pestaña
// del user no tenía mi listener controllerchange (circular: para
// ver el listener nuevo hace falta cargar el JS nuevo).
//
// Solución definitiva: NO INTERCEPTAR fetch de /_next/static ni de
// HTML. El browser pide directamente a red (cache HTTP normal con
// hash de Next, que es lo correcto). Sacrificamos modo offline
// completo a cambio de garantía absoluta de que el user siempre
// ve la versión actual desplegada.
//
// Lo que SÍ sigue haciendo el SW:
//   1. Notificaciones push (web-push).
//   2. Cola offline de mutaciones (POST/PATCH/DELETE): si la red
//      falla, guardamos en IndexedDB y reintentamos al volver
//      online.
//
// Si el user quiere offline mode más fuerte en el futuro,
// reintroducir cache PERO con purga agresiva por VERSION en
// activate.

const VERSION = "v106-2026-05-19-fal-key-settings";

self.addEventListener("install", (event) => {
  // Activación inmediata: no esperar a que el SW viejo libere.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borra TODAS las caches que pueda haber dejado el SW viejo
      // (hub-shell-v2 / hub-api-v2 / etc.). Sin esto, los chunks
      // antiguos persisten aunque ya no los usemos para fetch —
      // y la cuota de almacenamiento crece sin razón.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Toma control de las pestañas existentes.
      await self.clients.claim();
      // Avisa a todas las pestañas para que se recarguen una vez
      // (con el listener controllerchange del layout). Si la
      // pestaña tiene JS viejo SIN ese listener, no pasa nada —
      // el script inline del HTML hará la limpieza al próximo
      // render.
    })()
  );
});

// NO interceptamos fetch. Que el browser hable directamente con
// la red. Los assets de /_next/static/* tienen hash en el nombre
// → cache HTTP eterno es seguro. El HTML va por red cada vez
// (Next ya marca como no-store los pages dinámicos).

// Cola offline de mutaciones (solo para POST/PATCH/DELETE a la API).
// Si la red falla, encolamos en IndexedDB y reintentamos al
// recuperar conexión.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/api/")) return;
  event.respondWith(networkOrQueue(req));
});

async function networkOrQueue(req) {
  try {
    return await fetch(req.clone());
  } catch {
    await enqueueRequest(req);
    broadcast({ type: "queued", url: req.url, method: req.method });
    return new Response(
      JSON.stringify({ ok: true, queued: true, message: "Sin conexión: guardado para sincronizar" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ---- IndexedDB queue ----

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
        await new Promise((resolve) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(item.id);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        broadcast({ type: "flushed", url: item.url, ok: r.ok, status: r.status });
      }
    } catch {
      // Red sigue caída.
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "FLUSH_QUEUE") flushQueue();
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION" && event.ports?.[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "flush-outbox") event.waitUntil(flushQueue());
});

function broadcast(msg) {
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientsArr) => clientsArr.forEach((c) => c.postMessage(msg)));
}

// ---- Push notifications (mantenido del SW original) ----

self.addEventListener("push", (event) => {
  let data = { title: "Agencia Hub", body: "Tienes una notificación nueva", link: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}
  const options = {
    body: data.body,
    icon: "/api/brand-icon?size=192",
    badge: "/api/brand-icon?size=192",
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
