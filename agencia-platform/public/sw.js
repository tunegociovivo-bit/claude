// Service worker para notificaciones push de Agencia Hub.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
      // Si ya hay una ventana del Hub abierta, foco y navega
      const url = new URL(target, self.location.origin).href;
      for (const c of clientsArr) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) c.navigate(url);
          return;
        }
      }
      // si no, abre nueva
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
