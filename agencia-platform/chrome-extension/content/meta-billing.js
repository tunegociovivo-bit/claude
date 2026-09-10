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
  const capturedFiles = [];
  const capturedKeys = new Set();
  let harvestInProgress = false;

  // Puente: el interceptor (world MAIN) publica los PDFs capturados por
  // window.postMessage; los reenviamos al background para subirlos al Hub.
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.source === "hub-meta-pdf" && d.base64) {
      const key = `${d.name || "meta-factura.pdf"}:${d.base64.length}:${d.base64.slice(0, 48)}:${d.base64.slice(-48)}`;
      if (!capturedKeys.has(key)) {
        capturedKeys.add(key);
        capturedFiles.push({ name: d.name || "meta-factura.pdf", base64: d.base64 });
      }
      if (!harvestInProgress) {
        try {
          chrome.runtime.sendMessage({ from: "content", type: "meta-pdf-captured", name: d.name, base64: d.base64 });
        } catch {}
      }
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

  function collectVisibleInvoiceButtons() {
    const controls = [...document.querySelectorAll("button,[role='button'],a,span")]
      .filter((element) => /^\s*(?:descargar|download)\s+(?:pdf|factura|invoice|recibo|receipt)\s*$/i.test(element.textContent || ""))
      .map((element) => element.closest("button,[role='button'],a") || element)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    return [...new Set(controls)];
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForBillingRows(timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hasDownload = collectInvoiceUrls().length > 0 || collectVisibleInvoiceButtons().length > 0;
      const text = document.body?.innerText || "";
      const emptyConfirmed = /no hay transacciones|no tienes ninguna transacci[oó]n/i.test(text);
      if (hasDownload || emptyConfirmed) return;
      await wait(500);
    }
  }

  async function captureButtonDownloads() {
    const controls = collectVisibleInvoiceButtons().slice(0, 50);
    for (const control of controls) {
      control.click();
      await wait(200);
    }
    const deadline = Date.now() + 45_000;
    while (capturedFiles.length < controls.length && Date.now() < deadline) await wait(250);
    if (capturedFiles.length < controls.length) {
      throw new Error(`No respondieron todos los botones de descarga de Meta (${capturedFiles.length}/${controls.length}). Se reintentarÃ¡ sin marcar el trabajo como completado.`);
    }
    return { controls: controls.length, files: [...capturedFiles] };
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
        harvestInProgress = true;
        capturedFiles.length = 0;
        capturedKeys.clear();
        await waitForBillingRows();
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
        const buttonDownloads = await captureButtonDownloads();
        for (const file of buttonDownloads.files) {
          const key = `${file.name}:${file.base64.length}:${file.base64.slice(0, 48)}:${file.base64.slice(-48)}`;
          if (!files.some((existing) => `${existing.name}:${existing.base64.length}:${existing.base64.slice(0, 48)}:${existing.base64.slice(-48)}` === key)) files.push(file);
        }
        sendResponse({ ok: true, files, found: urls.length + buttonDownloads.controls, errors, emptyConfirmed });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      } finally {
        // The queue closes its background tab. For a manual harvest, keep a
        // short grace period so a delayed Meta response cannot be ingested twice.
        setTimeout(() => { harvestInProgress = false; }, 30_000);
      }
    })();
    return true; // respuesta asíncrona
  });
})();
