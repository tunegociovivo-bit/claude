(() => {
  if (window.__nvProspectingLoaded) return;
  window.__nvProspectingLoaded = true;

  const ask = (message) => new Promise((resolve) => chrome.runtime.sendMessage({ from: "linkedin-prospecting", ...message }, resolve));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const clip = (value, max) => clean(value).slice(0, max);

  function visiblePeople() {
    const resultsRoot = document.querySelector("main, [role='main']");
    if (!resultsRoot) return [];
    const links = [...resultsRoot.querySelectorAll('a[href^="/in/"], a[href*="linkedin.com/in/"]')];
    const seen = new Set();
    return links.flatMap((link) => {
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
      alert("No encuentro personas visibles. Espera a que LinkedIn termine de cargar los resultados.");
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    const preview = rows.slice(0, 5).map((row) => `• ${row.firstName} ${row.lastName} — ${row.jobTitle || "sin cargo"}${row.companyName ? ` · ${row.companyName}` : ""}`).join("\n");
    if (!confirm(`Se han detectado ${rows.length} personas visibles. Vista previa:\n\n${preview}\n\n¿Importarlas en «${campaigns[selected].name}»?`)) {
      button.disabled = false; button.textContent = "Importar a NV Prospección"; return;
    }
    button.textContent = `Importando ${rows.length}…`;
    const imported = await ask({ type: "prospecting-import", campaignId: campaigns[selected].id, rows });
    alert(imported?.ok ? `${imported.imported} contactos importados · ${imported.duplicates} duplicados omitidos.` : imported?.error || "No se pudo importar");
    button.disabled = false; button.textContent = "Importar a NV Prospección";
  }

  const button = document.createElement("button");
  button.id = "nv-prospecting-import";
  button.textContent = "Importar a NV Prospección";
  button.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;background:#4f46e5;color:white;border:0;border-radius:12px;padding:12px 16px;font:600 14px system-ui;box-shadow:0 8px 24px #0003;cursor:pointer";
  button.addEventListener("click", () => importVisible(button));
  document.documentElement.appendChild(button);
})();
