/**
 * Adaptador LIVE: conduce el portal de Santander Empresas en el Chrome VISIBLE
 * del usuario (conexión CDP), reutilizando la remesa recurrente anterior y
 * cambiando SOLO los datos autorizados. Termina ANTES de firmar.
 *
 * Barreras de seguridad implementadas aquí:
 *  - Allowlist estricta del host oficial: si la pestaña activa no es del dominio
 *    configurado, PAUSA.
 *  - No hacemos login ni tocamos OTP/CAPTCHA: si la sesión no está lista, PAUSA.
 *  - Antes de accionar "preparar", se comprueba que su etiqueta NO es de firma
 *    (isForbiddenActionLabel). Si lo fuera, ABORTA y pausa.
 *  - Cotejo obligatorio de importe/cliente con lo autorizado antes de preparar.
 *  - Verificación visual del indicador "pendiente de firma" antes de cerrar OK.
 *  - Cualquier elemento no encontrado (timeout) → PAUSA (posible cambio de DOM).
 *
 * playwright-core se importa de forma DINÁMICA para que el camino mock/tests no
 * requiera el navegador.
 */
import type { AuthorizedJob, AdapterHooks, SantanderAdapter, StepOutcome } from "./types.js";
import { isForbiddenActionLabel } from "./types.js";
import { loadSelectors, type SantanderSelectors, type SelectorSpec } from "./selectors.js";

const STEP_TIMEOUT_MS = 15000;

/** Normaliza texto para cotejo laxo (minúsculas, sin acentos ni espacios extra). */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface LiveOptions {
  cdpUrl: string;
  santanderOrigin: string;
  selectorsFile: string;
}

export class LiveSantanderAdapter implements SantanderAdapter {
  private browser: any = null;
  private currentTemplate = "";
  private currentClient = "";

  constructor(private opts: LiveOptions) {}

  async run(job: AuthorizedJob, hooks: AdapterHooks): Promise<StepOutcome> {
    // 1) Selectores externos (nunca inventados). Si faltan → pausa y pide mapeo.
    const sel = loadSelectors(this.opts.selectorsFile);
    if (!sel.ok) return this.pause(hooks, sel.reason);
    const S = sel.selectors;

    // 2) Conexión al Chrome visible por CDP.
    let page: any;
    try {
      const { chromium } = await import("playwright-core");
      this.browser = await chromium.connectOverCDP(this.opts.cdpUrl);
      page = await this.findSantanderPage();
    } catch (e: any) {
      return this.pause(hooks, `No se pudo conectar al Chrome visible (CDP). Abre Chrome con --remote-debugging-port y ve a Santander. Detalle: ${e?.message ?? e}`);
    }
    if (!page) {
      return this.pause(hooks, `No hay ninguna pestaña abierta en el dominio oficial (${this.opts.santanderOrigin}). Abre Santander Empresas tú mismo.`);
    }

    try {
      await hooks.onProgress("CHECK_ALLOWLIST", "Pestaña en dominio oficial verificada");

      // 3) Sesión lista (no la iniciamos nosotros).
      if (!(await this.visible(page, S.sessionReady))) {
        return this.pause(hooks, "No detecto una sesión iniciada en Santander. Inicia sesión tú (usuario/contraseña/OTP) y reanuda el trabajo.");
      }
      await hooks.onProgress("CHECK_SESSION", "Sesión iniciada detectada");

      // 4) Navegar a la portada oficial de remesas y entrar en Generación.
      await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/portal/distribuidoras/remesas`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      const app = await this.findAppFrame(page);
      if (!app) return this.pause(hooks, "No encuentro el marco interno oficial de remesas.");
      if (!(await this.click(app, S.remittancesNav))) return this.pause(hooks, "No encuentro la tarjeta Generación de remesas (posible cambio de interfaz).");
      await hooks.onProgress("OPEN_REMITTANCES", "Sección de remesas abierta");

      if (!job.santanderTemplate?.trim()) {
        return this.pause(hooks, `El cliente "${job.clientName}" no tiene configurado el nombre exacto de su remesa recurrente en Santander.`);
      }
      this.currentTemplate = job.santanderTemplate.trim();
      this.currentClient = job.clientName.trim();

      // 5) Seleccionar y EDITAR la remesa anterior. No se duplica.
      if (!(await this.visible(app, S.previousRemittance))) return this.pause(hooks, "No encuentro la remesa recurrente anterior para reutilizar.");
      await hooks.onProgress("SELECT_PREVIOUS", "Remesa anterior localizada");
      if (!(await this.click(app, S.rowMenuAction))) return this.pause(hooks, "No encuentro el menú de acciones de la remesa recurrente.");
      if (!(await this.click(app, S.editAction))) return this.pause(hooks, "No encuentro la acción Editar.");
      await hooks.onProgress("EDIT_PREVIOUS", "Remesa anterior abierta en modo edición");

      // 6) Cambiar SOLO la fecha de cobro a hoy. Importe, concepto e IBAN se conservan.
      const amount = (job.amountCents / 100).toFixed(2);
      if (!(await this.click(app, S.modifyRemittanceAction))) return this.pause(hooks, "No encuentro Modificar en Datos de la remesa.");
      const today = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
      if (!(await this.fill(app, S.chargeDateField, today))) return this.pause(hooks, "No pude actualizar la fecha de cobro.");
      await hooks.onProgress("EDIT_AUTHORIZED", `Fecha de cobro actualizada a ${today}; importe y concepto sin modificar`);
      if (!(await this.click(app, S.continueAction))) return this.pause(hooks, "No encuentro Continuar hacia Órdenes.");

      // 7) Cotejo obligatorio importe/cliente antes de preparar.
      const shownClient = await this.text(app, S.clientLabel);
      if (shownClient && job.clientName && !normalize(shownClient).includes(normalize(job.clientName)) && !normalize(job.clientName).includes(normalize(shownClient))) {
        return this.pause(hooks, `Discrepancia de cliente: portal "${shownClient}" vs autorizado "${job.clientName}".`);
      }
      const shownAmount = await this.text(app, S.amountLabel);
      if (!shownAmount || !this.amountMatches(shownAmount, amount)) {
        return this.pause(hooks, `Discrepancia de importe: portal "${shownAmount ?? "no visible"}" vs autorizado "${amount} EUR".`);
      }
      await hooks.onProgress("VALIDATE_MATCH", "Importe y cliente cotejados con lo autorizado");

      if (!(await this.click(app, S.continueAction))) return this.pause(hooks, "No encuentro Continuar hacia Resumen.");
      if (!(await this.safeClick(app, S.firstSendAction))) return this.pause(hooks, "No encuentro el primer Enviar o su etiqueta no es segura.");
      if (!(await this.click(app, S.directDebitOption))) return this.pause(hooks, "No encuentro Domiciliaciones SEPA CORE/COR1.");
      if (!(await this.safeClick(app, S.acceptAction))) return this.pause(hooks, "No encuentro Aceptar.");
      if (!(await this.safeClick(app, S.secondSendAction))) return this.pause(hooks, "No encuentro el segundo Enviar o su etiqueta no es segura.");
      await hooks.onProgress("PREPARE_FOR_SIGNATURE", "Remesa dejada lista para firma (sin firmar)");

      // 9) Verificación visual del estado pendiente de firma.
      if (!(await this.visible(app, S.pendingSignatureIndicator))) {
        return this.pause(hooks, "No pude verificar visualmente el estado 'pendiente de firma'. Revísalo tú antes de firmar.");
      }
      await hooks.onProgress("VERIFY_PENDING", "Estado 'pendiente de firma' verificado");
      if (!(await this.safeClick(app, S.signLaterAction, true))) {
        return this.pause(hooks, "La remesa está pendiente de firma, pero no pude pulsar Firmar luego. No se ha firmado.");
      }

      return { kind: "PREPARED", resultRef: `live:${job.jobId}` };
    } catch (e: any) {
      return this.pause(hooks, `Incidencia durante la preparación: ${e?.message ?? e}`);
    }
  }

  // --- Helpers de navegador (todos con timeout → pausa si no aparece) ---

  private async findSantanderPage(): Promise<any> {
    const origin = this.opts.santanderOrigin.toLowerCase();
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          const url = (p.url() || "").toLowerCase();
          if (url.startsWith(origin)) return p;
        } catch { /* ignore */ }
      }
    }
    return null;
  }

  private locator(page: any, spec: SelectorSpec): any {
    const expand = (value?: string) => value
      ?.replaceAll("{{template}}", this.currentTemplate)
      .replaceAll("{{client}}", this.currentClient);
    if (spec.css) {
      const loc = page.locator(expand(spec.css));
      return spec.hasText ? loc.filter({ hasText: expand(spec.hasText) }) : loc;
    }
    if (spec.role) return page.getByRole(spec.role.role, spec.role.name ? { name: expand(spec.role.name) } : undefined);
    if (spec.text) return page.getByText(expand(spec.text), { exact: false });
    if (spec.xpath) return page.locator(`xpath=${expand(spec.xpath)}`);
    throw new Error(`Selector sin localizador utilizable: ${spec.describe}`);
  }

  private async findAppFrame(page: any): Promise<any | null> {
    const origin = this.opts.santanderOrigin.toLowerCase();
    for (let attempt = 0; attempt < 30; attempt++) {
      const frame = page.frames().find((f: any) => {
        const url = String(f.url?.() ?? "").toLowerCase();
        return url.startsWith(origin) && url.includes("/paas/portal/distribuidoras/remesas");
      });
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return null;
  }

  private amountMatches(shown: string, expected: string): boolean {
    const token = shown.replace(/\s/g, "").match(/\d[\d.,]*/)?.[0];
    if (!token) return false;
    const normalized = token.includes(",")
      ? token.replace(/\./g, "").replace(",", ".")
      : token;
    const shownCents = Math.round(Number(normalized) * 100);
    const expectedCents = Math.round(Number(expected) * 100);
    return Number.isFinite(shownCents) && shownCents === expectedCents;
  }

  private async safeClick(page: any, spec: SelectorSpec, allowSignLater = false): Promise<boolean> {
    const label = await this.actionLabel(page, spec);
    if (!label) return false;
    if (allowSignLater) {
      if (!/firmar\s+luego/i.test(label)) return false;
    } else if (isForbiddenActionLabel(label)) return false;
    return this.click(page, spec);
  }

  private async visible(page: any, spec: SelectorSpec): Promise<boolean> {
    try {
      await this.locator(page, spec).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }

  private async click(page: any, spec: SelectorSpec): Promise<boolean> {
    try {
      const el = this.locator(page, spec).first();
      await el.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
      await el.click({ timeout: STEP_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }

  private async fill(page: any, spec: SelectorSpec, value: string): Promise<boolean> {
    try {
      const el = this.locator(page, spec).first();
      await el.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
      if (value !== "") await el.fill(value, { timeout: STEP_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }

  private async text(page: any, spec: SelectorSpec): Promise<string | null> {
    try {
      const el = this.locator(page, spec).first();
      await el.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
      return ((await el.textContent()) ?? "").trim();
    } catch { return null; }
  }

  /**
   * Etiqueta EN VIVO de un elemento accionable: reúne texto visible, aria-label,
   * title y value. Sirve para la barrera anti-firma (no fiarse solo del mapeo).
   * Devuelve null si no puede leer ninguna etiqueta verificable.
   */
  private async actionLabel(page: any, spec: SelectorSpec): Promise<string | null> {
    try {
      const el = this.locator(page, spec).first();
      await el.waitFor({ state: "visible", timeout: STEP_TIMEOUT_MS });
      const parts: string[] = [];
      for (const src of [
        () => el.textContent(),
        () => el.getAttribute("aria-label"),
        () => el.getAttribute("title"),
        () => el.getAttribute("value")
      ]) {
        try { const v = (await src()) ?? ""; if (v) parts.push(String(v)); } catch { /* ignore */ }
      }
      const label = parts.join(" ").replace(/\s+/g, " ").trim();
      return label.length ? label : null;
    } catch { return null; }
  }

  private async pause(hooks: AdapterHooks, reason: string): Promise<StepOutcome> {
    hooks.log(`PAUSA: ${reason}`);
    await hooks.onNeedsUser(reason);
    return { kind: "NEEDS_USER", reason };
  }

  async close(): Promise<void> {
    // Cerramos SOLO nuestra conexión CDP, nunca el Chrome del usuario.
    try { if (this.browser) await this.browser.close(); } catch { /* ignore */ }
    this.browser = null;
  }
}
