/* Install only on sites you own or are authorized to test. No network reporting. */
(() => {
  "use strict";
  if (window.nvWebQa || window.top !== window.self) return;
  const KEY = "nv-web-qa-v1";
  const sensitive = /(?:^|\/)(?:logout|signout|delete|remove|checkout|cart|wp-admin|wp-login|pago|comprar|carrito|eliminar|salir)(?:[/.\-_]|$)/i;
  let state;
  let timer;
  let deadlineTimer;
  let output;
  let startButton;
  const current = () => {
    const url = new URL(location.href);
    url.searchParams.delete("nv_test");
    url.hash = "";
    return url.href;
  };
  function valid(value) {
    if (!value || value.v !== 1 || !/^[a-f0-9-]{36}$/.test(value.id) || !Array.isArray(value.urls) || !value.urls.length || value.urls.length > 20 || !Number.isInteger(value.seconds) || value.seconds < 30 || value.seconds > 900) return false;
    return value.urls.every((item) => {
      const url = new URL(item);
      return item.length <= 2000 && url.protocol === "https:" && url.origin === location.origin && !url.username && !url.password && !url.search && !url.hash && !sensitive.test(decodeURIComponent(url.pathname));
    }) && value.urls.includes(current());
  }
  try {
    if (location.hash.startsWith("#nv-qa=")) {
      if (location.hash.length > 60000) return;
      const config = JSON.parse(decodeURIComponent(location.hash.slice(7)));
      if (!valid(config)) return;
      state = { ...config, status: "ready", createdAt: Date.now(), endsAt: 0, visits: 0, events: [] };
      sessionStorage.setItem(KEY, JSON.stringify(state));
      history.replaceState(history.state, "", location.pathname + location.search);
    } else {
      state = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (!valid(state) || !Array.isArray(state.events) || state.events.length > 300 || !Number.isInteger(state.visits) || state.visits < 0 || state.visits > 30 || !Number.isFinite(state.createdAt) || state.createdAt > Date.now() || Date.now() - state.createdAt > 3600000 || !["ready", "running", "completed", "stopped", "error"].includes(state.status)) return;
      if (state.status === "running" && (!Number.isFinite(state.endsAt) || state.endsAt > Date.now() + 900000)) return;
    }
  } catch { return; }

  window.NV_WEB_QA = Object.freeze({ synthetic: true, id: state.id });
  function persist() { sessionStorage.setItem(KEY, JSON.stringify(state)); }
  function record(type, detail) {
    if (state.events.length < 300) state.events.push({ at: new Date().toISOString(), type, path: location.pathname, ...detail });
    persist();
    window.dispatchEvent(new CustomEvent("nv:web-qa", { detail: { id: state.id, synthetic: true, type } }));
  }
  function paint() {
    if (output) output.textContent = `Prueba sintetica · ${state.status} · ${Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000))} s · ${state.events.length} acciones`;
    if (startButton) startButton.disabled = state.status !== "ready";
  }
  function finish(status) {
    clearTimeout(timer); clearTimeout(deadlineTimer);
    if (["ready", "running"].includes(state.status)) { state.status = status; record("finish", { status }); }
    paint();
  }
  function download() {
    const blob = new Blob([JSON.stringify({ ...state, synthetic: true, heatmap: "not-configured" }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `nv-web-qa-${state.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function schedule() {
    clearTimeout(timer);
    if (state.status !== "running") return;
    if (Date.now() >= state.endsAt || state.events.length >= 295 || state.visits >= 30) { finish("completed"); return; }
    if (!document.hidden) timer = setTimeout(step, 2500 + Math.floor(Math.random() * 3500));
    paint();
  }
  function step() {
    if (state.status !== "running") return;
    if (!state.urls.includes(current())) { finish("error"); return; }
    if (document.hidden || Date.now() >= state.endsAt) { schedule(); return; }
    try {
      const links = Array.from(document.querySelectorAll("a[href]")).flatMap((link) => {
        if (link.hasAttribute("download") || link.closest("form") || link.target && link.target !== "_self" || !link.getClientRects().length) return [];
        const url = new URL(link.href, location.href);
        // Follow only exact, explicitly approved GET destinations. Do not invoke page click handlers.
        if (url.origin !== location.origin || url.search || url.hash || !state.urls.includes(url.href) || url.href === current()) return [];
        return [url];
      });
      if (links.length && Math.random() < 0.3 && state.visits < 29) {
        const destination = links[Math.floor(Math.random() * links.length)];
        destination.searchParams.set("nv_test", state.id);
        record("link-navigation", { destination: destination.pathname });
        location.assign(destination.href);
        return;
      }
      const amount = Math.round(window.innerHeight * (0.25 + Math.random() * 0.45)) * (Math.random() < 0.2 ? -1 : 1);
      window.scrollBy({ top: amount, behavior: "smooth" });
      record("scroll-request", { delta: amount, fromY: Math.round(window.scrollY) });
      schedule();
    } catch { finish("error"); }
  }
  function start() {
    if (state.status !== "ready") return;
    state.status = "running"; state.endsAt = Date.now() + state.seconds * 1000;
    state.visits = 1; record("start", {}); record("page", {}); armDeadline(); schedule();
  }
  function armDeadline() {
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => finish("completed"), Math.max(0, state.endsAt - Date.now()));
  }
  function mount() {
    const host = document.createElement("div");
    host.id = "nv-web-qa-controls";
    host.style.cssText = "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host{font:13px system-ui;color:#17202a}section{background:#fff;border:2px solid #047857;padding:10px;border-radius:6px;box-shadow:0 2px 12px #0003}p{margin:0 0 8px;overflow-wrap:anywhere}button{font:inherit;background:#fff;border:1px solid #94a3b8;padding:8px;margin:0 6px 4px 0;border-radius:4px;color:#17202a}button:disabled{opacity:.4}";
    const box = document.createElement("section"); box.setAttribute("aria-label", "Control de prueba sintetica");
    output = document.createElement("p"); output.setAttribute("role", "status"); box.append(output);
    const button = (label, handler) => { const element = document.createElement("button"); element.type = "button"; element.textContent = label; element.addEventListener("click", handler); box.append(element); return element; };
    startButton = button("Iniciar prueba", start);
    button("Detener", () => finish("stopped"));
    button("Descargar informe", download);
    root.append(style, box); document.body.append(host); paint();
    if (state.status === "running") { state.visits += 1; record("page", {}); armDeadline(); schedule(); }
  }
  window.nvWebQa = Object.freeze({ stop: () => finish("stopped"), download });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) schedule();
  });
  window.addEventListener("pagehide", () => { clearTimeout(timer); clearTimeout(deadlineTimer); });
  window.addEventListener("pageshow", (event) => { if (event.persisted && state.status === "running") { armDeadline(); schedule(); } });
  window.addEventListener("error", () => { if (state.status === "running") record("page-error", {}); });
  window.addEventListener("unhandledrejection", () => { if (state.status === "running") record("unhandled-rejection", {}); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})();
