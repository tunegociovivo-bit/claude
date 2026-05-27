/**
 * Service worker de Bipi PWA. Escucha 'push' y muestra la notificación.
 *
 * Payload esperado (JSON): { title, body, link?, tag?, icon? }
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
    data = { title: "Bipi", body: event.data ? event.data.text() : "Tienes una novedad" };
  }
  const title = data.title || "Bipi";
  const options = {
    body: data.body || "",
    icon: data.icon || "/bipi-icon-192.png",
    badge: "/bipi-badge-72.png",
    tag: data.tag,
    data: { link: data.link || "/bipi/app" },
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/bipi/app";
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
