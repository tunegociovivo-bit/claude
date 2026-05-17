/**
 * Content-script para páginas de videoconferencia (Meet, Teams, Zoom,
 * etc — ver manifest.content_scripts.matches).
 *
 * Dos cosas:
 *  1. Avisa al service worker de que esta pestaña ES una reunión
 *     (badge rojo en el icono).
 *  2. Inyecta — bajo demanda del SW — un BANNER FLOTANTE en la
 *     esquina con selector de proyecto + columna + botón "Grabar".
 *     Así el user no tiene que pinchar el icono de la extensión.
 *
 * El banner usa Shadow DOM para aislarse del CSS de Meet/Teams y no
 * romperse cuando estas apps re-renderizan su layout.
 *
 * NO captura audio. La captura se inicia tras un gesto explícito
 * (click en "Grabar" del banner) — Chrome lo exige para tabCapture.
 */

(function () {
  function pingMeetingDetected() {
    try {
      chrome.runtime.sendMessage({ from: "content", type: "meeting-detected" }, (resp) => {
        // PULL: justo después del ping, preguntamos al SW si deberíamos
        // mostrar el banner. Así no dependemos de que el SW alcance a
        // empujar el mensaje antes de que nuestro onMessage listener
        // esté listo (race condition al cargar Meet/Teams).
        if (resp?.shouldShowBanner) tryMountBanner();
      });
    } catch {}
  }
  pingMeetingDetected();
  // Re-intentar 3 veces en los primeros 6s — Meet/Teams cargan en SPA
  // y a veces la primera vez el SW aún no tiene user en storage.
  setTimeout(pingMeetingDetected, 2000);
  setTimeout(pingMeetingDetected, 6000);

  // Meet es SPA — si cambia la URL sin recargar, re-pingar
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      pingMeetingDetected();
    }
  }, 4000);

  // ─────────────────────────────────────────────────────────────────
  // Banner flotante — se monta cuando el SW pide "show-record-banner"
  // ─────────────────────────────────────────────────────────────────

  const BANNER_ID = "__nv-hub-record-banner__";
  let bannerOpen = false;
  let dismissedAt = 0;
  const DISMISS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min — si cerró, no insistir

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.from === "sw" && msg?.type === "show-record-banner") {
      tryMountBanner();
    }
    if (msg?.from === "sw" && msg?.type === "live-suggestions") {
      showLiveSuggestions(msg.suggestions ?? []);
    }
  });

  function tryMountBanner() {
    if (bannerOpen) return;
    if (Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;
    mountBanner();
  }

  function fetchProjects() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "timeout 10s del SW" }), 10000);
      try {
        chrome.runtime.sendMessage({ from: "content", type: "fetch-projects" }, (resp) => {
          clearTimeout(timer);
          resolve(resp ?? { ok: false, error: "respuesta vacía del SW" });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  function startRecording(projectId, status, live) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { from: "content", type: "start-recording-from-banner", projectId, status, live: !!live },
          (resp) => resolve(resp ?? { ok: false, error: "sin respuesta" })
        );
      } catch (e) {
        resolve({ ok: false, error: String(e?.message ?? e) });
      }
    });
  }

  function mountBanner() {
    if (document.getElementById(BANNER_ID)) return;
    bannerOpen = true;

    const host = document.createElement("div");
    host.id = BANNER_ID;
    host.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .card { background:#fff; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,.2),0 4px 6px -2px rgba(0,0,0,.05); border:1px solid #e2e8f0; padding:14px; color:#0f172a; font-size:13px; animation:slideIn .25s ease-out; }
        @keyframes slideIn { from { transform:translateX(20px); opacity:0; } to { transform:translateX(0); opacity:1; } }
        .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
        .title { font-weight:600; font-size:13px; display:flex; align-items:center; gap:6px; }
        .dot { width:8px; height:8px; border-radius:50%; background:#ef4444; }
        .close { background:transparent; border:0; cursor:pointer; color:#64748b; font-size:16px; line-height:1; padding:2px 6px; border-radius:4px; }
        .close:hover { background:#f1f5f9; color:#0f172a; }
        .row { margin-bottom:8px; }
        label { display:block; font-size:11px; color:#64748b; margin-bottom:3px; font-weight:500; }
        select, button.rec { width:100%; padding:7px 10px; border-radius:8px; border:1px solid #cbd5e1; background:#fff; font-size:12px; font-family:inherit; }
        select:focus { outline:2px solid #6366f1; outline-offset:-1px; }
        .actions { display:flex; gap:6px; margin-top:12px; }
        button.rec { background:#ef4444; color:#fff; border:0; font-weight:600; cursor:pointer; transition:background .15s; display:flex; align-items:center; justify-content:center; gap:6px; }
        button.rec:hover { background:#dc2626; }
        button.rec:disabled { background:#94a3b8; cursor:not-allowed; }
        button.secondary { background:transparent; color:#475569; border:1px solid #cbd5e1; padding:7px 10px; border-radius:8px; font-size:12px; cursor:pointer; font-family:inherit; }
        button.secondary:hover { background:#f1f5f9; }
        .err { color:#dc2626; font-size:11px; margin-top:6px; }
        .muted { color:#64748b; font-size:11px; margin-top:8px; }
        .loading { color:#64748b; font-size:12px; text-align:center; padding:20px 0; }
      </style>
      <div class="card">
        <div class="header">
          <div class="title"><span class="dot"></span><span>Reunión detectada</span></div>
          <button class="close" id="close-btn" title="Cerrar">×</button>
        </div>
        <div id="content"><div class="loading">Cargando proyectos…</div></div>
      </div>
    `;
    document.documentElement.appendChild(host);

    const closeBtn = shadow.getElementById("close-btn");
    closeBtn.onclick = () => {
      dismissedAt = Date.now();
      bannerOpen = false;
      host.remove();
    };

    const content = shadow.getElementById("content");

    fetchProjects().then((resp) => {
      // resp puede venir como { ok:true, projects:[...] } o { ok:false, error }
      const projects = Array.isArray(resp?.projects) ? resp.projects : (Array.isArray(resp) ? resp : []);
      if (projects.length === 0) {
        const errMsg = resp?.error
          ? `Error: ${resp.error}`
          : "No se pudieron cargar los proyectos. Asegúrate de tener sesión en hub.negociovivo.app.";
        content.innerHTML = `
          <div class="err">${escapeText(errMsg)}</div>
          <button class="secondary" style="width:100%;margin-top:8px" id="retry-btn">Reintentar</button>
        `;
        shadow.getElementById("retry-btn").onclick = () => {
          host.remove();
          bannerOpen = false;
          mountBanner();
        };
        return;
      }
      const projectOpts = projects.map((p) => `<option value="${escapeAttr(p.id)}">${escapeText(p.name)}</option>`).join("");
      content.innerHTML = `
        <div class="row">
          <label for="proj-sel">Proyecto destino</label>
          <select id="proj-sel">${projectOpts}</select>
        </div>
        <div class="row">
          <label for="col-sel">Columna</label>
          <select id="col-sel"></select>
        </div>
        <div class="row" style="display:flex;align-items:center;gap:6px;font-size:11px;">
          <input type="checkbox" id="live-mode" style="margin:0;cursor:pointer" />
          <label for="live-mode" style="cursor:pointer;color:#475569;">⚡ Asistencia en vivo (NV IA sugiere durante la reunión)</label>
        </div>
        <div class="actions">
          <button class="secondary" id="cancel-btn" style="flex:0 0 auto">Cancelar</button>
          <button class="rec" id="rec-btn" style="flex:1">⏺ Grabar</button>
        </div>
        <div id="err" class="err" style="display:none"></div>
        <div class="muted">Al detener se transcribe + resume con IA y se crea una tarea en el destino elegido.</div>
      `;
      const projSel = shadow.getElementById("proj-sel");
      const colSel = shadow.getElementById("col-sel");
      const recBtn = shadow.getElementById("rec-btn");
      const cancelBtn = shadow.getElementById("cancel-btn");
      const errEl = shadow.getElementById("err");

      function syncColumns() {
        const proj = projects.find((p) => p.id === projSel.value);
        const cols = Array.isArray(proj?.kanbanColumns) && proj.kanbanColumns.length > 0
          ? proj.kanbanColumns.map((c) => ({ id: c.id ?? c.label, label: c.label ?? c.id }))
          : [
              { id: "TODO", label: "Por hacer" },
              { id: "IN_PROGRESS", label: "En curso" },
              { id: "REVIEW", label: "Revisión" },
              { id: "DONE", label: "Hecho" }
            ];
        colSel.innerHTML = cols.map((c) => `<option value="${escapeAttr(c.id)}">${escapeText(c.label)}</option>`).join("");
      }
      projSel.onchange = syncColumns;
      syncColumns();

      cancelBtn.onclick = closeBtn.onclick;

      recBtn.onclick = async () => {
        recBtn.disabled = true;
        recBtn.textContent = "Iniciando…";
        errEl.style.display = "none";
        const liveMode = !!shadow.getElementById("live-mode").checked;
        const r = await startRecording(projSel.value, colSel.value, liveMode);
        if (r.ok) {
          content.innerHTML = `
            <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} .rec-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 1.5s infinite;margin-right:6px;}</style>
            <div style="text-align:center;padding:10px 0;">
              <div style="font-size:14px;color:#ef4444;font-weight:600;margin-bottom:8px;"><span class="rec-dot"></span>Grabando</div>
              <div style="font-size:11px;color:#64748b;">Abre la extensión cuando quieras detener.</div>
            </div>
          `;
        } else {
          recBtn.disabled = false;
          recBtn.textContent = "⏺ Grabar";
          errEl.textContent = "Error al iniciar: " + (r.error ?? "desconocido");
          errEl.style.display = "block";
        }
      };
    });
  }

  // Φ5 — overlay flotante con sugerencias en vivo
  const LIVE_PANEL_ID = "__nv-hub-live-panel__";
  function showLiveSuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;
    let host = document.getElementById(LIVE_PANEL_ID);
    let shadow;
    if (!host) {
      host = document.createElement("div");
      host.id = LIVE_PANEL_ID;
      host.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:2147483646;width:340px;max-width:calc(100vw - 32px);max-height:60vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
      shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          .panel { background:#fff; border-radius:12px; box-shadow:0 10px 25px -5px rgba(0,0,0,.2); border:1px solid #e2e8f0; max-height:60vh; display:flex; flex-direction:column; }
          .head { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #e2e8f0; }
          .title { font-size:12px; font-weight:600; color:#0f172a; display:flex; align-items:center; gap:6px; }
          .dot { width:8px; height:8px; border-radius:50%; background:#10b981; animation:p 1.5s infinite; }
          @keyframes p { 0%,100%{opacity:1} 50%{opacity:.4} }
          .close { background:transparent; border:0; cursor:pointer; color:#64748b; font-size:18px; padding:2px 6px; }
          .list { padding:8px; overflow-y:auto; flex:1; }
          .item { padding:8px 10px; margin-bottom:6px; border-left:3px solid #6366f1; background:#f8fafc; border-radius:6px; }
          .item.action_item { border-color:#10b981; }
          .item.tone_alert { border-color:#ef4444; }
          .item.decision_point { border-color:#f59e0b; }
          .t { font-size:12px; font-weight:600; color:#0f172a; margin-bottom:3px; }
          .b { font-size:11px; color:#475569; line-height:1.4; }
          .tag { display:inline-block; font-size:9px; text-transform:uppercase; letter-spacing:0.05em; color:#6366f1; margin-right:4px; font-weight:600; }
          .item.action_item .tag { color:#10b981; }
          .item.tone_alert .tag { color:#ef4444; }
          .item.decision_point .tag { color:#f59e0b; }
        </style>
        <div class="panel">
          <div class="head">
            <span class="title"><span class="dot"></span>NV IA en vivo</span>
            <button class="close" id="ls-close">×</button>
          </div>
          <div class="list" id="ls-list"></div>
        </div>
      `;
      document.documentElement.appendChild(host);
      shadow.getElementById("ls-close").onclick = () => host.remove();
    } else {
      shadow = host.shadowRoot;
    }
    const list = shadow.getElementById("ls-list");
    // Prepend nuevas sugerencias (las últimas arriba)
    for (const s of suggestions) {
      const div = document.createElement("div");
      div.className = "item " + s.type;
      const tagMap = { action_item: "Acción", info_lookup: "Buscar", tone_alert: "Tono", search_suggestion: "Tema", decision_point: "Decisión" };
      div.innerHTML = `<div class="t"><span class="tag">${escapeAttr(tagMap[s.type] ?? s.type)}</span>${escapeAttr(s.title)}</div>` + (s.body ? `<div class="b">${escapeAttr(s.body)}</div>` : "");
      list.insertBefore(div, list.firstChild);
    }
    // Cap visible — quedan en DOM pero no se ven más de 20
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeText(s) { return escapeAttr(s); }
})();
