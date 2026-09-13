(() => {
  "use strict";
  if (document.getElementById("nv-linkedin-job-import") || !globalThis.NVLinkedInJobsCore) return;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const text = (...selectors) => {
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  };
  const href = (...selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element?.href || element?.getAttribute?.("href");
      if (value) return new URL(value, location.origin).href;
    }
    return "";
  };
  const ask = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ from: "linkedin-prospecting", ...message }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });

  function captureVisibleJob() {
    const jobUrl = href(
      ".job-details-jobs-unified-top-card__job-title a[href*='/jobs/view/']",
      ".jobs-unified-top-card__job-title a[href*='/jobs/view/']",
      "a.job-card-list__title--link[aria-current='page']",
      ".jobs-search-results-list__list-item--active a[href*='/jobs/view/']"
    ) || location.href;
    return globalThis.NVLinkedInJobsCore.buildPayload({
      company: text(
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        ".job-details-jobs-unified-top-card__primary-description-container a[href*='/company/']"
      ),
      jobTitle: text(
        ".job-details-jobs-unified-top-card__job-title h1",
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title h1",
        ".jobs-unified-top-card__job-title"
      ),
      location: text(
        ".job-details-jobs-unified-top-card__tertiary-description-container",
        ".jobs-unified-top-card__bullet",
        ".job-details-jobs-unified-top-card__primary-description-container span"
      ),
      jobUrl,
      companyUrl: href(
        ".job-details-jobs-unified-top-card__company-name a[href*='/company/']",
        ".jobs-unified-top-card__company-name a[href*='/company/']",
        ".job-details-jobs-unified-top-card__primary-description-container a[href*='/company/']"
      ),
      description: text(".jobs-description__content", ".jobs-box__html-content", "#job-details")
    });
  }

  const button = document.createElement("button");
  button.id = "nv-linkedin-job-import";
  button.type = "button";
  button.textContent = "Añadir a Empleos + Prospección";
  button.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647;background:#0f766e;color:#fff;border:0;border-radius:12px;padding:12px 16px;font:600 14px system-ui;box-shadow:0 8px 24px #0003;cursor:pointer";
  button.addEventListener("click", async () => {
    const payload = captureVisibleJob();
    if (!payload) {
      alert("No he podido leer la empresa, el puesto o el enlace de la oferta seleccionada. Abre primero el detalle de una oferta de LinkedIn.");
      return;
    }
    button.disabled = true;
    button.textContent = "Preparando email + LinkedIn…";
    const response = await ask({ type: "prospecting-job-import", offer: payload });
    button.disabled = false;
    if (!response?.ok) {
      button.textContent = "Añadir a Empleos + Prospección";
      alert(response?.error || "No se pudo enviar la oferta al Hub");
      return;
    }
    button.textContent = response.created ? "✓ Oferta añadida" : "✓ Oferta ya vinculada";
    setTimeout(() => { button.textContent = "Añadir a Empleos + Prospección"; }, 6000);
    alert(`${response.created ? "Oferta añadida" : "Oferta actualizada"}. ${response.emailFound ? "Email localizado/preparado." : "El email se seguirá buscando."} ${response.linkedinDrafted ? "Mensaje de LinkedIn listo en NV Prospección." : "El responsable de LinkedIn queda pendiente de localizar."}`);
  });
  document.documentElement.appendChild(button);
})();
