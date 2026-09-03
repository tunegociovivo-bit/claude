(() => {
  if (window.__hubInvoiceHarvesterLoaded) return;
  window.__hubInvoiceHarvesterLoaded = true;

  function looksLikePdf(href, text) {
    const value = `${href || ""} ${text || ""}`.toLowerCase();
    return /(pdf|download|descargar)/.test(value) && /(invoice|factura|receipt|recibo|document|billing|transacci)/.test(value);
  }

  async function fetchPdf(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    const blob = await response.blob();
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (!/pdf|octet-stream/i.test(type) && String.fromCharCode(...head) !== "%PDF") throw new Error("La descarga no devolvió un PDF");
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    let name = match ? decodeURIComponent(match[1]) : (new URL(url).pathname.split("/").pop() || "factura.pdf");
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { name, base64 };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "harvest-accountancy-invoices") return;
    (async () => {
      const candidates = [...document.querySelectorAll("a[href]")]
        .map((link) => ({ url: new URL(link.getAttribute("href"), location.href).href, text: link.textContent || "" }))
        .filter((entry) => looksLikePdf(entry.url, entry.text));
      const unique = [...new Map(candidates.map((entry) => [entry.url, entry])).values()].slice(0, 200);
      const files = [];
      const errors = [];
      for (const entry of unique) {
        try { files.push(await fetchPdf(entry.url)); } catch (error) { errors.push(`${entry.text.trim() || entry.url}: ${error?.message || error}`); }
      }
      sendResponse({ ok: true, found: unique.length, files, errors: errors.slice(0, 20) });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
