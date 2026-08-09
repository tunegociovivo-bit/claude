/**
 * MODO GRABACIÓN GUIADA. Se ejecuta en una sesión REAL supervisada por el
 * usuario para MAPEAR los selectores del portal (no se inventan nunca). El
 * usuario navega e indica cada elemento haciendo clic; el agente captura un
 * selector estable y escribe `selectors.json`.
 *
 * Este modo NO prepara ni firma nada: solo observa clics para construir el mapa.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentConfig } from "../config.js";
import type { Logger } from "../logger.js";

interface Step {
  key: string;
  prompt: string;
  optional?: boolean;
}

const STEPS: Step[] = [
  { key: "sessionReady", prompt: "Un elemento visible SOLO tras iniciar sesión (p. ej. tu nombre o el menú principal)." },
  { key: "remittancesNav", prompt: "El acceso/menú a Remesas o Adeudos SEPA (Norma 19 / recibos)." },
  { key: "previousRemittance", prompt: "La remesa recurrente ANTERIOR que se reutilizará." },
  { key: "duplicateAction", prompt: "El botón/acción para DUPLICAR o reutilizar esa remesa anterior." },
  { key: "amountField", prompt: "El campo editable del IMPORTE." },
  { key: "chargeDateField", prompt: "El campo editable de FECHA de cargo (opcional).", optional: true },
  { key: "conceptField", prompt: "El campo editable de CONCEPTO/referencia (opcional).", optional: true },
  { key: "clientLabel", prompt: "El elemento que muestra el CLIENTE/deudor (para cotejo)." },
  { key: "ibanLabel", prompt: "El elemento que muestra el IBAN del deudor, enmascarado (opcional).", optional: true },
  { key: "prepareAction", prompt: "La acción que deja la remesa LISTA PARA FIRMA sin firmar (p. ej. 'Guardar'/'Preparar'). NUNCA 'Firmar'." },
  { key: "pendingSignatureIndicator", prompt: "El indicador/badge que confirma el estado 'PENDIENTE DE FIRMA'." }
];

// Algoritmo in-page para calcular un selector estable del elemento pulsado.
const SELECTOR_FN = `(el) => {
  function sel(node){
    if(!node || node.nodeType!==1) return null;
    if(node.id) return '#' + CSS.escape(node.id);
    const dt = node.getAttribute('data-testid') || node.getAttribute('data-test') || node.getAttribute('name');
    if(dt){ return node.tagName.toLowerCase() + '[' + (node.getAttribute('data-testid')?'data-testid':node.getAttribute('data-test')?'data-test':'name') + '="' + dt + '"]'; }
    let path=[]; let cur=node;
    while(cur && cur.nodeType===1 && path.length<6){
      let part=cur.tagName.toLowerCase();
      if(cur.id){ path.unshift('#'+CSS.escape(cur.id)); break; }
      const p=cur.parentNode;
      if(p){ const same=[...p.children].filter(c=>c.tagName===cur.tagName); if(same.length>1){ part += ':nth-of-type('+(same.indexOf(cur)+1)+')'; } }
      path.unshift(part); cur=p;
    }
    return path.join(' > ');
  }
  const text=(el.innerText||el.textContent||'').trim().slice(0,60);
  const role=el.getAttribute('role')||({A:'link',BUTTON:'button',INPUT:'textbox'})[el.tagName]||'';
  return { css: sel(el), text, role, tag: el.tagName.toLowerCase() };
}`;

export async function runRecorder(cfg: AgentConfig, log: Logger): Promise<void> {
  const { chromium } = await import("playwright-core");
  log.info("Conectando al Chrome visible por CDP para grabar selectores…");
  const browser = await chromium.connectOverCDP(cfg.chromeCdpUrl);

  const origin = cfg.santanderOrigin.toLowerCase();
  let page: any = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if ((p.url() || "").toLowerCase().startsWith(origin)) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) {
    log.error(`No hay pestaña en el dominio oficial (${cfg.santanderOrigin}). Ábrela e inicia sesión antes de grabar.`);
    await browser.close();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  const selectors: Record<string, any> = {};
  log.info("Grabación iniciada. Para cada paso: sitúate en la pantalla correcta y pulsa INTRO; luego HAZ CLIC en el elemento indicado dentro de Chrome.");

  for (const step of STEPS) {
    const label = step.optional ? `${step.key} (opcional, escribe 's' para saltar)` : step.key;
    const skip = await ask(`\n▶ ${label}\n  ${step.prompt}\n  Pulsa INTRO y luego clic en el elemento… `);
    if (step.optional && skip.trim().toLowerCase() === "s") { log.info(`Saltado: ${step.key}`); continue; }

    const captured = await captureNextClick(page);
    if (!captured?.css) { log.warn(`No se capturó selector para ${step.key}; se omite.`); continue; }
    const spec: any = { css: captured.css, describe: step.prompt };
    if (captured.text) spec.text = captured.text;
    selectors[step.key] = spec;
    log.info(`Capturado ${step.key}: ${captured.css}`);
  }

  rl.close();
  const out = resolve(process.cwd(), cfg.selectorsFile);
  writeFileSync(out, JSON.stringify(selectors, null, 2), "utf8");
  log.info(`Selectores escritos en ${out}. Revísalos y prueba en modo mock antes de 'live'.`);
  await browser.close();
}

async function captureNextClick(page: any): Promise<{ css: string; text: string; role: string; tag: string } | null> {
  return new Promise(async (resolve) => {
    let done = false;
    const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
    try {
      await page.exposeBinding("__nvCapture", async (_src: any, data: any) => finish(data));
      await page.evaluate(`(${captureInstaller})(${SELECTOR_FN})`);
    } catch (e) {
      finish(null);
    }
    // Salvaguarda: si en 120s no hay clic, devuelve null.
    setTimeout(() => finish(null), 120000);
  });
}

// Instalador in-page: en el próximo clic, calcula el selector y lo envía por el binding.
const captureInstaller = `(computeFn) => {
  const handler = (ev) => {
    try {
      ev.preventDefault(); ev.stopPropagation();
      const data = computeFn(ev.target);
      document.removeEventListener('click', handler, true);
      // @ts-ignore
      window.__nvCapture(data);
    } catch (e) {}
  };
  document.addEventListener('click', handler, true);
}`;
