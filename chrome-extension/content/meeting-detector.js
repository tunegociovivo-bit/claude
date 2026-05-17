/**
 * Content-script que se inyecta en los dominios de videoconferencia
 * listados en manifest.content_scripts.matches. Su único trabajo es
 * avisar al service worker de que esta pestaña ES una reunión, para
 * que ponga el badge rojo "●" en el icono. Sin esto el user no
 * tiene una pista visual de cuándo la extensión es útil.
 *
 * NO captura audio ni hace nada más. La captura solo se inicia tras
 * un gesto explícito del user (click en el icono → popup → "Grabar"),
 * como exige Chrome para tabCapture.
 */

(function () {
  try {
    chrome.runtime.sendMessage({ from: "content", type: "meeting-detected" });
  } catch {
    // Si la extensión está deshabilitada o el contexto perdió la
    // conexión con el service worker, no hacemos nada.
  }

  // Algunos meets navegan client-side sin recargar (Google Meet hace
  // SPA cuando aceptas la cámara). Re-emitimos el ping en cambios
  // de location para que el badge no se pierda.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      try {
        chrome.runtime.sendMessage({ from: "content", type: "meeting-detected" });
      } catch {}
    }
  }, 4000);
})();
