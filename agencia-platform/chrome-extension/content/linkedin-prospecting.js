(() => {
  if (window.__nvProspectingLoaded) return;
  window.__nvProspectingLoaded = true;

  const ask = (message) => new Promise((resolve) => chrome.runtime.sendMessage({ from: "linkedin-prospecting", ...message }, resolve));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const clip = (value, max) => clean(value).slice(0, max);
  const getStored = (key) => new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key])));
  const setStored = (key, value) => new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  const removeStored = (key) => new Promise((resolve) => chrome.storage.local.remove(key, resolve));
  const BATCH_KEY = "nvLinkedInProspectingBatch";
  const TAB_TOKEN_KEY = "nvLinkedInProspectingTabToken";
  const tabToken = sessionStorage.getItem(TAB_TOKEN_KEY) || crypto.randomUUID();
  sessionStorage.setItem(TAB_TOKEN_KEY, tabToken);
  const batchStorageKey = `${BATCH_KEY}:${tabToken}`;
  let navigationTimer = null;

  function currentPage() {
    const page = Number(new URL(location.href).searchParams.get("page") || "1");
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function searchIdentity() {
    const url = new URL(location.href);
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !["page", "start"].includes(key))
      .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    return `${url.pathname}?${new URLSearchParams(params).toString()}`;
  }

  function hasLinkedInChallenge() {
    return /captcha|security verification|verificación de seguridad|unusual activity|actividad inusual|account restricted|cuenta restringida/i.test(document.body.innerText || "");
  }

  function nextPageControl() {
    const main = document.querySelector("main, [role='main']") || document;
    const pager = main.querySelector(".artdeco-pagination, [data-view-name*='pagination'], nav[aria-label*='página' i], nav[aria-label*='page' i]");
    if (!pager) return null;
    const candidates = [...pager.querySelectorAll("a, button")];
    return candidates.find((element) => {
      const label = clean(element.innerText || element.getAttribute("aria-label"));
      const disabled = element.disabled || element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled");
      return !disabled && /^(siguiente|next|página siguiente|next page)$/i.test(label);
    }) || null;
  }

  function visiblePeople() {
    const resultsRoot = document.querySelector("main, [role='main']");
    if (!resultsRoot) return [];
    const links = [...resultsRoot.querySelectorAll('a[href^="/in/"], a[href*="linkedin.com/in/"]')];
    const seen = new Set();
    const linkedRows = links.flatMap((link) => {
      const linkedinUrl = new URL(link.href, location.origin);
      linkedinUrl.search = "";
      linkedinUrl.hash = "";
      if (!/^\/in\/[^/]+\/?$/.test(linkedinUrl.pathname) || seen.has(linkedinUrl.href)) return [];
      const card = link.closest("[data-view-name='search-entity-result-universal-template'], li.reusable-search__result-container, .entity-result, [data-chameleon-result-urn], li");
      if (!card || !resultsRoot.contains(card) || card.closest("aside, nav, header")) return [];
      const ariaName = clean(link.getAttribute("aria-label"))
        .replace(/^view\s+(.+?)[’']s\s+profile$/i, "$1")
        .replace(/^(?:ver|view)(?:\s+el|\s+the)?\s+(?:perfil|profile)(?:\s+de|\s+of)?\s+/i, "")
        .replace(/[’']s\s+profile$/i, "");
      const candidates = [
        link.querySelector("span[aria-hidden='true']")?.textContent,
        link.textContent,
        card.querySelector("span[dir='ltr']")?.textContent,
        ariaName
      ].map(clean).filter((value) => value && value.length <= 120 && !/^(ver|view|perfil|profile|mensaje|message|conectar|connect)$/i.test(value));
      const name = candidates[0]?.replace(/\s*[•·]\s*(?:1er|2º|3er|1st|2nd|3rd).*$/i, "").trim();
      if (!name || /linkedin member|miembro de linkedin/i.test(name)) return [];
      seen.add(linkedinUrl.href);
      const parts = name.split(" ");
      const lines = (card.innerText || card.textContent || "").split(/\n+/).map(clean).filter(Boolean);
      const nameIndex = lines.findIndex((line) => line.includes(name));
      const fallbackHeadline = lines.slice(Math.max(0, nameIndex + 1)).find((line) => line !== name && line.length <= 240 && !/^(1er|2º|3er|1st|2nd|3rd|mensaje|message|conectar|connect|seguir|follow)/i.test(line));
      const headline = clean(card.querySelector(".entity-result__primary-subtitle, .t-14.t-black.t-normal, [data-view-name='search-entity-result-universal-template'] [class*='primary-subtitle']")?.textContent || fallbackHeadline);
      const headlineParts = headline.split(/\s+(?:en|at|@)\s+/i);
      return [{
        firstName: clip(parts.shift() || name, 120),
        lastName: clip(parts.join(" "), 120),
        companyName: headlineParts.length > 1 ? clip(headlineParts.slice(1).join(" en "), 240) : "",
        jobTitle: clip(headlineParts[0] || headline, 240),
        linkedinUrl: linkedinUrl.href
      }];
    });
    // LinkedIn prueba una variante donde las tarjetas visibles no exponen
    // enlaces /in/. En ese caso usamos los botones Conectar/Mensaje como
    // ancla y leemos únicamente la tarjeta del resultado dentro de <main>.
    const actionButtons = [...resultsRoot.querySelectorAll("button")].filter((candidate) =>
      /^(conectar|connect|mensaje|message)$/i.test(clean(candidate.innerText || candidate.getAttribute("aria-label")))
    );
    const seenSources = new Set();
    const fallbackRows = actionButtons.flatMap((actionButton) => {
      let card = actionButton.closest("[data-view-name='search-entity-result-universal-template'], li.reusable-search__result-container, .entity-result, [data-chameleon-result-urn], li");
      if (!card) {
        card = actionButton.parentElement;
        while (card?.parentElement && card.parentElement !== resultsRoot) {
          const lines = (card.innerText || card.textContent || "").split(/\n+/).map(clean).filter(Boolean);
          if (lines.length >= 4 && lines.length <= 12) break;
          card = card.parentElement;
        }
      }
      if (!card || !resultsRoot.contains(card) || card.closest("aside, nav, header")) return [];
      const lines = (card.innerText || card.textContent || "").split(/\n+/).map(clean).filter(Boolean);
      const nameLine = lines.find((line) =>
        line.length >= 3 && line.length <= 120 && /\s/.test(line) && !/^(conectar|connect|mensaje|message|seguir|follow|actual:|anterior:|resumen:)/i.test(line)
      );
      const name = clean(nameLine)
        .replace(/^(?:seleccionar\s+a|select)\s+/i, "")
        .replace(/\s*[•·]\s*(?:1er|2º|3er|1st|2nd|3rd).*$/i, "");
      if (!name || /linkedin member|miembro de linkedin/i.test(name)) return [];
      const nameIndex = lines.indexOf(nameLine);
      const headline = lines.slice(nameIndex + 1).find((line) =>
        line.length <= 240 && !/^(conectar|connect|mensaje|message|seguir|follow|actual:|anterior:|resumen:)/i.test(line)
      ) || "";
      const current = lines.find((line) => /^(actual|current):/i.test(line)) || "";
      const currentParts = current.replace(/^(actual|current):\s*/i, "").split(/\s+(?:en|at|@)\s+/i);
      const headlineParts = headline.split(/\s+(?:en|at|@)\s+/i);
      const companyName = currentParts.length > 1 ? currentParts.at(-1) : headlineParts.length > 1 ? headlineParts.at(-1) : "";
      const profileLink = card.querySelector('a[href^="/in/"], a[href*="linkedin.com/in/"]');
      const linkedinUrl = profileLink ? new URL(profileLink.href, location.origin).href.split(/[?#]/)[0] : "";
      if (linkedinUrl && seen.has(linkedinUrl)) return [];
      const sourceElement = card.matches("[data-chameleon-result-urn], [data-entity-urn], [data-urn]")
        ? card
        : card.querySelector("[data-chameleon-result-urn], [data-entity-urn], [data-urn]");
      const rawSourceKey = sourceElement?.getAttribute("data-chameleon-result-urn") || sourceElement?.getAttribute("data-entity-urn") || sourceElement?.getAttribute("data-urn");
      const sourceKey = clip(rawSourceKey || `visible:${name}|${headline}|${current}`, 500).toLowerCase();
      if (seenSources.has(sourceKey)) return [];
      seenSources.add(sourceKey);
      const parts = name.split(" ");
      return [{
        firstName: clip(parts.shift() || name, 120),
        lastName: clip(parts.join(" "), 120),
        companyName: clip(companyName, 240),
        jobTitle: clip(headlineParts[0] || headline, 240),
        linkedinUrl,
        sourceKey
      }];
    });
    return [...linkedRows, ...fallbackRows];
  }

  async function importVisible(button) {
    button.disabled = true;
    button.textContent = "Cargando campañas…";
    const response = await ask({ type: "prospecting-campaigns" });
    if (!response?.ok) {
      alert(response?.error || "No se pudo conectar con el Hub");
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const campaigns = (response.campaigns || []).filter((campaign) => ["draft", "active", "paused"].includes(campaign.status));
    if (!campaigns.length) {
      alert("Crea primero una campaña en NV Prospección.");
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const menu = campaigns.map((campaign, index) => `${index + 1}. ${campaign.name}`).join("\n");
    const selected = Number(prompt(`Elige la campaña de destino:\n\n${menu}`, "1")) - 1;
    if (!campaigns[selected]) { button.disabled = false; button.textContent = "Importar a NV Prospección"; return; }
    const rows = visiblePeople();
    if (!rows.length) {
      const profileLinks = document.querySelectorAll('main a[href*="/in/"], [role="main"] a[href*="/in/"]').length;
      const actionButtons = [...document.querySelectorAll("main button, [role='main'] button")].filter((candidate) => /conectar|connect|mensaje|message/i.test(clean(candidate.innerText || candidate.getAttribute("aria-label")))).length;
      alert(`No encuentro tarjetas importables. Diagnóstico: ${profileLinks} enlaces de perfil y ${actionButtons} botones de contacto visibles.`);
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const preview = rows.slice(0, 5).map((row) => `• ${row.firstName} ${row.lastName} — ${row.jobTitle || "sin cargo"}${row.companyName ? ` · ${row.companyName}` : ""}`).join("\n");
    if (!confirm(`Se han detectado ${rows.length} personas visibles. Vista previa:\n\n${preview}\n\n¿Importarlas en «${campaigns[selected].name}»?`)) {
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const requestedPages = Number(prompt("¿Cuántas páginas quieres importar automáticamente? Máximo 100. Escribe 1 para importar solo esta página.", "10"));
    if (!Number.isInteger(requestedPages) || requestedPages < 1 || requestedPages > 100) {
      alert("Indica un número de páginas entre 1 y 100.");
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const job = {
      ownerToken: tabToken,
      campaignId: campaigns[selected].id,
      campaignName: campaigns[selected].name,
      searchIdentity: searchIdentity(),
      expectedPage: currentPage(),
      remaining: requestedPages,
      imported: 0,
      duplicates: 0,
      startedAt: Date.now()
    };
    await setStored(batchStorageKey, job);
    await runBatchPage(button, job);
  }

  async function runBatchPage(button, job) {
    const activeJob = await getStored(batchStorageKey);
    if (!activeJob || activeJob.ownerToken !== tabToken || activeJob.campaignId !== job.campaignId || activeJob.searchIdentity !== job.searchIdentity) {
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      return;
    }
    job = activeJob;
    if (currentPage() !== job.expectedPage) {
      await removeStored(batchStorageKey);
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      alert(`La importación esperaba la página ${job.expectedPage}, pero LinkedIn muestra la ${currentPage()}. Se ha detenido para no mezclar resultados.`);
      return;
    }
    stopButton.style.display = "block";
    if (hasLinkedInChallenge()) {
      await removeStored(batchStorageKey);
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      alert("LinkedIn ha mostrado una verificación o restricción. La importación se ha detenido sin continuar navegando.");
      return;
    }
    const rows = visiblePeople();
    if (!rows.length) {
      await removeStored(batchStorageKey);
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      alert(`La importación se detuvo en la página ${currentPage()}: no se detectaron tarjetas válidas.`);
      return;
    }
    button.disabled = true;
    button.textContent = `Importando página ${currentPage()}…`;
    const result = await ask({ type: "prospecting-import", campaignId: job.campaignId, rows });
    if (!result?.ok) {
      await removeStored(batchStorageKey);
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      alert(result?.error || "No se pudo importar esta página");
      return;
    }
    if (!await getStored(batchStorageKey)) {
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      return;
    }
    const updated = {
      ...job,
      imported: job.imported + (result.imported || 0),
      duplicates: job.duplicates + (result.duplicates || 0),
      remaining: job.remaining - 1
    };
    const next = nextPageControl();
    if (updated.remaining <= 0 || !next) {
      await removeStored(batchStorageKey);
      stopButton.style.display = "none";
      button.disabled = false; button.textContent = "Importar a NV Prospección";
      alert(`Importación finalizada: ${updated.imported} contactos importados · ${updated.duplicates} duplicados omitidos.`);
      return;
    }
    updated.expectedPage = currentPage() + 1;
    await setStored(batchStorageKey, updated);
    button.textContent = `Página ${currentPage()} lista · siguiente en 12 s`;
    navigationTimer = setTimeout(() => {
      next.click();
      // LinkedIn puede cambiar de página como SPA sin recargar el content
      // script. Si el documento sobrevive, reanudamos aquí; si recarga, lo
      // hará el bloque de recuperación al final del archivo.
      let checks = 0;
      const waitForPage = setInterval(() => {
        checks++;
        if (currentPage() === updated.expectedPage) {
          clearInterval(waitForPage);
          setTimeout(() => runBatchPage(button, updated), 4000);
        } else if (checks >= 30) {
          clearInterval(waitForPage);
          void (async () => {
            const stalled = await getStored(batchStorageKey);
            if (stalled?.ownerToken !== tabToken) return;
            await removeStored(batchStorageKey);
            stopButton.style.display = "none";
            button.disabled = false;
            button.textContent = "Importar a NV Prospección";
            alert("LinkedIn no avanzó a la página siguiente. La importación se ha detenido.");
          })();
        }
      }, 1000);
    }, 12000);
  }

  const button = document.createElement("button");
  button.id = "nv-prospecting-import";
  button.textContent = "Importar a NV Prospección";
  button.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;background:#4f46e5;color:white;border:0;border-radius:12px;padding:12px 16px;font:600 14px system-ui;box-shadow:0 8px 24px #0003;cursor:pointer";
  button.addEventListener("click", () => importVisible(button));
  document.documentElement.appendChild(button);

  const stopButton = document.createElement("button");
  stopButton.textContent = "Detener importación";
  stopButton.style.cssText = "display:none;position:fixed;right:22px;bottom:76px;z-index:2147483647;background:#fff;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:9px 13px;font:600 12px system-ui;box-shadow:0 6px 18px #0002;cursor:pointer";
  stopButton.addEventListener("click", async () => {
    if (navigationTimer) clearTimeout(navigationTimer);
    await removeStored(batchStorageKey);
    stopButton.style.display = "none";
    button.disabled = false;
    button.textContent = "Importar a NV Prospección";
    alert("Importación detenida.");
  });
  document.documentElement.appendChild(stopButton);

  void (async () => {
    const job = await getStored(batchStorageKey);
    if (!job || job.ownerToken !== tabToken || job.searchIdentity !== searchIdentity() || job.expectedPage !== currentPage()) return;
    if (Date.now() - job.startedAt > 2 * 60 * 60 * 1000) { await removeStored(batchStorageKey); return; }
    setTimeout(() => runBatchPage(button, job), 4000);
  })();
})();
