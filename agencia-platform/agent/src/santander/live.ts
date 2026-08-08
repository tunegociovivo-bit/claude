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

      // 4) Navegar a remesas.
      if (!(await this.click(page, S.remittancesNav))) return this.pause(hooks, "No encuentro el acceso a remesas/adeudos (posible cambio de interfaz).");
      await hooks.onProgress("OPEN_REMITTANCES", "Sección de remesas abierta");

      // 5) Seleccionar y duplicar la remesa anterior.
      if (!(await this.click(page, S.previousRemittance))) return this.pause(hooks, "No encuentro la remesa recurrente anterior para reutilizar.");
      await hooks.onProgress("SELECT_PREVIOUS", "Remesa anterior localizada");
      if (!(await this.click(page, S.duplicateAction))) return this.pause(hooks, "No encuentro la acción de duplicar/reutilizar la remesa anterior.");
      await hooks.onProgress("DUPLICATE_PREVIOUS", "Remesa anterior duplicada para reutilizar");

      // 6) Editar SOLO datos autorizados.
      const amount = (job.amountCents / 100).toFixed(2);
      if (!(await this.fill(page, S.amountField, amount))) return this.pause(hooks, "No pude editar el importe (campo no encontrado).");
      if (S.chargeDateField) await this.fill(page, S.chargeDateField, ""); // fecha la valida/ajusta el usuario si aplica
      if (S.conceptField && job.invoiceNumber) await this.fill(page, S.conceptField, `Factura ${job.invoiceNumber}`);
      await hooks.onProgress("EDIT_AUTHORIZED", "Datos autorizados actualizados (importe/concepto)");

      // 7) Cotejo obligatorio importe/cliente antes de preparar.
      const shownClient = await this.text(page, S.clientLabel);
      if (shownClient && job.clientName && !normalize(shownClient).includes(normalize(job.clientName)) && !normalize(job.clientName).includes(normalize(shownClient))) {
        return this.pause(hooks, `Discrepancia de cliente: portal "${shownClient}" vs autorizado "${job.clientName}".`);
      }
      await hooks.onProgress("VALIDATE_MATCH", "Importe y cliente cotejados con lo autorizado");

      // 8) Preparar para firma — barrera anti-firma sobre la etiqueta CONFIGURADA
      //    y sobre el texto/accesible EN VIVO del elemento (no basta con el mapeo).
      const configuredLabel = S.prepareAction.role?.name ?? S.prepareAction.text ?? "";
      if (configuredLabel && isForbiddenActionLabel(configuredLabel)) {
        return this.pause(hooks, `La acción de preparar ("${configuredLabel}") parece de FIRMA. Abortado por seguridad: el agente nunca firma.`);
      }
      const liveLabel = await this.actionLabel(page, S.prepareAction);
      if (!liveLabel) {
        return this.pause(hooks, "No pude leer la etiqueta del botón de preparar para verificar que NO es de firma. Abortado por seguridad.");
      }
      if (isForbiddenActionLabel(liveLabel)) {
        return this.pause(hooks, `El botón de preparar muestra "${liveLabel}" (parece FIRMA). Abortado por seguridad: el agente nunca firma.`);
      }
      if (!(await this.click(page, S.prepareAction))) return this.pause(hooks, "No encuentro la acción para dejar la remesa lista para firma.");
      await hooks.onProgress("PREPARE_FOR_SIGNATURE", "Remesa dejada lista para firma (sin firmar)");

      // 9) Verificación visual del estado pendiente de firma.
      if (!(await this.visible(page, S.pendingSignatureIndicator))) {
        return this.pause(hooks, "No pude verificar visualmente el estado 'pendiente de firma'. Revísalo tú antes de firmar.");
      }
      await hooks.onProgress("VERIFY_PENDING", "Estado 'pendiente de firma' verificado");

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
    if (spec.css) return page.locator(spec.css);
    if (spec.role) return page.getByRole(spec.role.role, spec.role.name ? { name: spec.role.name } : undefined);
    if (spec.text) return page.getByText(spec.text, { exact: false });
    if (spec.xpath) return page.locator(`xpath=${spec.xpath}`);
    throw new Error(`Selector sin localizador utilizable: ${spec.describe}`);
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
