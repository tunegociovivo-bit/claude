/**
 * Interceptor de descargas de facturas de Meta (se ejecuta en el contexto
 * de la PÁGINA — world MAIN — para poder envolver fetch/XHR de Meta).
 *
 * No adivina selectores ni URLs: simplemente detecta cuando la página de
 * facturación descarga un PDF (al pulsar TÚ el botón "Descargar" de Meta) y
 * lo reenvía (base64) al content script aislado vía window.postMessage, que
 * a su vez lo manda al background para archivarlo en el Hub.
 *
 * Robusto frente a cambios de UI de Meta: capturamos cualquier respuesta
 * application/pdf, venga del botón que venga.
 */
(() => {
  if (window.__hubMetaIntercept) return;
  window.__hubMetaIntercept = true;

  const sent = new Set();

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function nameFrom(headers, url) {
    try {
      const cd = headers?.get?.("content-disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      if (m) return decodeURIComponent(m[1]);
    } catch {}
    const u = (url || "").split("?")[0];
    let n = u.split("/").pop() || "meta-factura.pdf";
    if (!/\.pdf$/i.test(n)) n = "meta-factura.pdf";
    return n;
  }

  async function emitIfPdf(contentType, headers, url, blob) {
    if (!/application\/pdf|octet-stream/i.test(contentType || "")) return;
    if (!blob || blob.size < 500) return; // descarta respuestas vacías/errores
    const key = `${blob.size}:${url || ""}`;
    if (sent.has(key)) return;
    sent.add(key);
    try {
      const base64 = await blobToBase64(blob);
      window.postMessage({ source: "hub-meta-pdf", name: nameFrom(headers, url), base64 }, "*");
    } catch {}
  }

  // --- fetch ---
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const resp = await origFetch.apply(this, args);
      try {
        const ct = resp.headers.get("content-type") || "";
        if (/application\/pdf|octet-stream/i.test(ct)) {
          resp
            .clone()
            .blob()
            .then((b) => emitIfPdf(ct, resp.headers, resp.url, b))
            .catch(() => {});
        }
      } catch {}
      return resp;
    };
  }

  // --- XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__hubUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (!/application\/pdf|octet-stream/i.test(ct)) return;
        let blob = null;
        if (this.response instanceof Blob) blob = this.response;
        else if (this.response instanceof ArrayBuffer) blob = new Blob([this.response], { type: "application/pdf" });
        if (blob) {
          emitIfPdf(ct, { get: (h) => this.getResponseHeader(h) }, this.__hubUrl, blob);
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
