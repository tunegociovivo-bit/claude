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

  function allDocuments() {
    const documents = [document];
    for (const frame of document.querySelectorAll("iframe")) {
      try { if (frame.contentDocument) documents.push(frame.contentDocument); } catch {}
    }
    return documents;
  }

  function matchesPeriod(text, periodKey) {
    if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) return true;
    const [year, month] = periodKey.split("-");
    const names = [
      ["enero", "ene", "january", "jan"], ["febrero", "feb", "february"], ["marzo", "mar", "march"],
      ["abril", "abr", "april", "apr"], ["mayo", "may"], ["junio", "jun", "june"],
      ["julio", "jul", "july"], ["agosto", "ago", "august", "aug"], ["septiembre", "sept", "sep", "september"],
      ["octubre", "oct", "october"], ["noviembre", "nov", "november"], ["diciembre", "dic", "december", "dec"]
    ][Number(month) - 1] || [];
    const normalized = String(text || "").toLowerCase();
    const numeric = new RegExp(`(?:${year}[-/.]${month}(?:[-/.]\\d{1,2})?|\\d{1,2}[-/.]${month}[-/.]${year})`);
    return numeric.test(normalized) || (normalized.includes(year) && names.some((name) => new RegExp(`\\b${name}\\b`, "i").test(normalized)));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "harvest-accountancy-invoices") return;
    (async () => {
      const isGoogle = location.hostname === "ads.google.com" || location.hostname === "payments.google.com";
      let billingLoaded = false;
      const candidates = allDocuments().flatMap((doc) => {
        const bodyText = doc.body?.innerText || "";
        if (location.hostname === "payments.google.com" && (
          doc.querySelector("[data-url*='/payments/apis-secure/doc/']") ||
          /documentos fiscales|tax documents|fecha de emisi[o\u00f3]n|issue date/i.test(bodyText)
        )) billingLoaded = true;
        const links = [...doc.querySelectorAll("a[href]")]
          .map((link) => ({ url: new URL(link.getAttribute("href"), location.href).href, text: link.closest("tr, [role=row]")?.textContent || link.textContent || "" }))
          .filter((entry) => looksLikePdf(entry.url, entry.text))
          .filter((entry) => !isGoogle || matchesPeriod(entry.text, message.periodKey));
        const googleDocuments = [...doc.querySelectorAll("[data-url]")]
          .map((control) => ({
            url: new URL(control.getAttribute("data-url"), location.origin).href,
            text: control.closest("tr, [role=row]")?.textContent || control.textContent || ""
          }))
          .filter((entry) => /\/payments\/apis-secure\/doc\//.test(entry.url))
          .filter((entry) => matchesPeriod(entry.text, message.periodKey));
        return [...links, ...googleDocuments];
      });
      const unique = [...new Map(candidates.map((entry) => [entry.url, entry])).values()].slice(0, 200);
      const files = [];
      const errors = [];
      for (const entry of unique) {
        try { files.push(await fetchPdf(entry.url)); } catch (error) { errors.push(`${entry.text.trim() || entry.url}: ${error?.message || error}`); }
      }
      sendResponse({ ok: true, found: unique.length, files, errors: errors.slice(0, 20), emptyConfirmed: unique.length === 0 && Boolean(message.periodKey) && billingLoaded });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
