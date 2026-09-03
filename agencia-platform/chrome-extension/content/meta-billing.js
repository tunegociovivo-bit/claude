/**
 * Content script — recolector de facturas de Meta.
 *
 * Se inyecta en las páginas de facturación de Meta Business
 * (business.facebook.com / facebook.com). Cuando el background le pide
 * "harvest-meta-invoices", busca en la página los enlaces de descarga de
 * facturas/recibos y, usando la SESIÓN YA INICIADA del usuario (mismo
 * origen, con sus cookies), descarga cada PDF y lo devuelve en base64 al
 * background, que lo sube al Hub. No automatiza login ni escribe nada en
 * Meta: solo lee/descarga lo que el usuario ya puede ver.
 *
 * NOTA: el panel de facturación de Meta cambia con frecuencia. Este
 * recolector es best-effort por heurística de enlaces; si Meta cambia el
 * marcado, hay que recalibrar los selectores de abajo (CANDIDATE_MATCH).
 */

(() => {
  if (window.__hubMetaBillingLoaded) return;
  window.__hubMetaBillingLoaded = true;

  // Puente: el interceptor (world MAIN) publica los PDFs capturados por
  // window.postMessage; los reenviamos al background para subirlos al Hub.
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.source === "hub-meta-pdf" && d.base64) {
      try {
        chrome.runtime.sendMessage({ from: "content", type: "meta-pdf-captured", name: d.name, base64: d.base64 });
      } catch {}
    }
  });

  // Heurística: enlaces que parecen descarga de factura/recibo.
  function looksLikeInvoiceLink(href) {
    if (!href) return false;
    const h = href.toLowerCase();
    const hasKeyword = /(invoice|receipt|factura|recibo|transaction|billing)/.test(h);
    const isDownload = /(download|\.pdf|format=pdf|render=pdf|async\/billing)/.test(h);
    return hasKeyword && isDownload;
  }

  function collectInvoiceUrls() {
    const urls = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const abs = href.startsWith("http") ? href : new URL(href, location.origin).href;
      if (looksLikeInvoiceLink(abs)) urls.add(abs);
    });
    // Algunos botones llevan la URL en data-* en vez de href.
    document.querySelectorAll("[data-href],[data-download-url]").forEach((el) => {
      const href = el.getAttribute("data-href") || el.getAttribute("data-download-url") || "";
      if (looksLikeInvoiceLink(href)) {
        urls.add(href.startsWith("http") ? href : new URL(href, location.origin).href);
      }
    });
    return [...urls];
  }

  async function fetchAsBase64(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get("content-type") || "";
    // Solo nos interesan PDFs (evita traer HTML de una página de error).
    if (!/pdf|octet-stream/.test(ct.toLowerCase())) throw new Error(`no-pdf (${ct})`);
    const blob = await r.blob();
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    const base64 = String(dataUrl).split(",")[1] ?? "";
    // Nombre a partir de Content-Disposition o de la URL.
    const cd = r.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    let name = m ? decodeURIComponent(m[1]) : url.split("/").pop()?.split("?")[0] || "meta-factura.pdf";
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    return { name, base64 };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "harvest-meta-invoices") return;
    (async () => {
      try {
        const urls = collectInvoiceUrls();
        const files = [];
        const errors = [];
        for (const url of urls.slice(0, 50)) {
          try {
            files.push(await fetchAsBase64(url));
          } catch (e) {
            errors.push(`${url.slice(0, 60)}: ${e?.message ?? e}`);
          }
        }
        const emptyConfirmed = /no hay transacciones|no tienes ninguna transacción/i.test(document.body?.innerText || "");
        sendResponse({ ok: true, files, found: urls.length, errors, emptyConfirmed });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
    })();
    return true; // respuesta asíncrona
  });
})();
