/**
 * Service worker de Bubui PWA. Escucha 'push' y muestra la notificación.
 *
 * Payload esperado (JSON): { title, body, link?, tag?, icon?, image? }
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Bubui", body: event.data ? event.data.text() : "Tienes una novedad" };
  }
  const title = data.title || "Bubui";
  const options = {
    body: data.body || "",
    icon: data.icon || "/bubui-icon-192.png",
    badge: "/bubui-badge-72.png",
    tag: data.tag,
    // `image` muestra una foto grande en la notificación; al tocarla (o tocar
    // la notificación) se abre el enlace de la oferta gestionado más abajo.
    image: data.image || undefined,
    data: { link: data.link || "/bubui/app" },
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/bubui/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.focus();
          c.navigate(link);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
