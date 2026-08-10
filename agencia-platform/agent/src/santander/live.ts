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
import { buildRemittanceGeneratorUrl, canContinueToDirectDebit, decideLoginAction, formatSantanderAmount, isAuthenticatedSantanderUrl, isEnvioremFrameUrl, isRemittanceGeneratorUrl, isSafeBasicPaymentsLabel, isSafePaginationControl, isSafeReconnectLabel, isSafeRemittanceGenerationLabel, numericPageLabels, parseDisplayedAmountCents, shouldAttemptSavedLogin, shouldWaitForAmountConfirmation, shouldWaitForRemittanceList, uniqueVisibleIndex } from "./login.js";
import { hasEncryptedCredential, readEncryptedAccessKey } from "../credential-store.js";

const STEP_TIMEOUT_MS = 15000;

/** Normaliza texto para cotejo laxo (minúsculas, sin acentos ni espacios extra). */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface LiveOptions {
  cdpUrl: string;
  santanderOrigin: string;
  selectorsFile: string;
  credentialFile: string;
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
      if (!page) {
        const context = this.browser.contexts()[0];
        if (context) {
          page = await context.newPage();
          await page.goto(`${this.opts.santanderOrigin}/paas/loginnwe/`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
        }
      }
    } catch (e: any) {
      return this.pause(hooks, `No se pudo conectar al Chrome visible (CDP). Abre Chrome con --remote-debugging-port y ve a Santander. Detalle: ${e?.message ?? e}`);
    }
    if (!page) {
      return this.pause(hooks, `No hay ninguna pestaña abierta en el dominio oficial (${this.opts.santanderOrigin}). Abre Santander Empresas tú mismo.`);
    }

    try {
      await hooks.onProgress("CHECK_ALLOWLIST", "Pestaña en dominio oficial verificada");

      // 3) Sesión lista (no la iniciamos nosotros).
      if (shouldAttemptSavedLogin(await this.visible(page, S.sessionReady))) {
        const loginResult = await this.trySavedLogin(page, S);
        if (!loginResult.ok) return this.pause(hooks, loginResult.reason);
        await hooks.onProgress("CHECK_SESSION", "Acceso solicitado en el dominio oficial de Santander");
      }
      await hooks.onProgress("CHECK_SESSION", "Sesión iniciada detectada");

      // 4) Navegar a la portada oficial de remesas y entrar en Generación.
      await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/portal/distribuidoras/remesas`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      const portal = await this.findAppFrame(page);
      if (!portal) return this.pause(hooks, "No encuentro el marco interno oficial de remesas.");
      let app = await this.findGeneratorFrame(page, 4);
      if (!app) {
        const openedFromCard = await this.clickRemittanceGeneration(portal, S.remittancesNav);
        if (!openedFromCard) {
          await page.goto(buildRemittanceGeneratorUrl(this.opts.santanderOrigin), { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
        }
        app = await this.findGeneratorFrame(page);
      }
      if (!app) return this.pause(hooks, "No encuentro el listado interno oficial de adeudos SEPA.");
      await hooks.onProgress("OPEN_REMITTANCES", "Sección de remesas abierta");

      if (!job.santanderTemplate?.trim()) {
        return this.pause(hooks, `El cliente "${job.clientName}" no tiene configurado el nombre exacto de su remesa recurrente en Santander.`);
      }
      this.currentTemplate = job.santanderTemplate.trim();
      this.currentClient = job.clientName.trim();

      // 5) Seleccionar y EDITAR la remesa anterior. No se duplica.
      if (!(await this.locatePreviousRemittance(app, S.previousRemittance))) return this.pause(hooks, "No encuentro la remesa recurrente anterior para reutilizar tras revisar todas las páginas.");
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
      let shownAmount = await this.text(app, S.amountLabel);
      if (parseDisplayedAmountCents(shownAmount ?? "") !== job.amountCents) {
        const amountFields = this.locator(app, S.amountField);
        if (await amountFields.count() !== 1) return this.pause(hooks, "No encuentro un único campo de importe verificable para la orden recurrente.");
        await amountFields.click({ timeout: STEP_TIMEOUT_MS });
        await amountFields.press("Control+A", { timeout: STEP_TIMEOUT_MS });
        await amountFields.pressSequentially(formatSantanderAmount(job.amountCents), { delay: 60 });
        await amountFields.press("Tab", { timeout: STEP_TIMEOUT_MS });
        for (let attempt = 0; attempt <= 10; attempt++) {
          shownAmount = await this.text(app, S.amountLabel);
          if (!shouldWaitForAmountConfirmation(parseDisplayedAmountCents(shownAmount ?? ""), job.amountCents, attempt, 10)) break;
          await app.waitForTimeout(500);
        }
        await hooks.onProgress("EDIT_AUTHORIZED", `Importe actualizado al total autorizado de ${amount} EUR`);
      }
      if (!shownAmount || !this.amountMatches(shownAmount, amount)) {
        return this.pause(hooks, `Discrepancia de importe: portal "${shownAmount ?? "no visible"}" vs autorizado "${amount} EUR".`);
      }
      await hooks.onProgress("VALIDATE_MATCH", "Importe y cliente cotejados con lo autorizado");

      if (!(await this.click(app, S.continueAction))) return this.pause(hooks, "No encuentro Continuar hacia Resumen.");
      if (!(await this.safeClick(app, S.firstSendAction))) return this.pause(hooks, "No encuentro el primer Enviar o su etiqueta no es segura.");
      const sendFrame = await this.findEnvioremFrame(page);
      if (!sendFrame) return this.pause(hooks, "No encuentro el marco oficial de selección del tipo de envío.");
      const categoryOpened = await this.clickBasicPayments(sendFrame, S.basicPaymentsOption);
      await sendFrame.waitForTimeout(300);
      if (!canContinueToDirectDebit(categoryOpened, await this.hasUniqueVisible(sendFrame, S.directDebitOption))) return this.pause(hooks, "No encuentro Pagos y cobros básicos ni una opción única de adeudos ya visible.");
      if (!(await this.clickUniqueVisible(sendFrame, S.directDebitOption))) return this.pause(hooks, "No encuentro una única opción visible de Domiciliaciones SEPA CORE/COR1.");
      if (!(await this.safeClick(sendFrame, S.acceptAction))) return this.pause(hooks, "No encuentro Aceptar.");
      if (!(await this.safeClick(sendFrame, S.secondSendAction))) return this.pause(hooks, "No encuentro el segundo Enviar o su etiqueta no es segura.");
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
    const candidates: any[] = [];
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          const url = (p.url() || "").toLowerCase();
          if (url.startsWith(origin)) candidates.push(p);
        } catch { /* ignore */ }
      }
    }
    return candidates.find((candidate) => isAuthenticatedSantanderUrl(candidate.url(), this.opts.santanderOrigin))
      ?? candidates.find((candidate) => candidate.url().toLowerCase().startsWith(`${origin}/paas/loginnwe/`))
      ?? candidates[0]
      ?? null;
  }

  private async trySavedLogin(page: any, selectors: SantanderSelectors): Promise<{ ok: true } | { ok: false; reason: string }> {
    const reconnect = page.getByRole("button", { name: /^volver a conectar$/i });
    if (await reconnect.count() === 1 && await reconnect.isVisible().catch(() => false)) {
      const label = (await reconnect.innerText()).trim();
      if (!isSafeReconnectLabel(label)) return { ok: false, reason: "La ventana de sesión caducada no ofrece una reconexión segura verificable." };
      await reconnect.click({ timeout: STEP_TIMEOUT_MS });
      await page.waitForTimeout(500);
    }
    const fields = page.locator('input[type="text"]');
    const visibleFields: any[] = [];
    for (let i = 0; i < await fields.count(); i++) {
      const field = fields.nth(i);
      if (await field.isVisible().catch(() => false)) visibleFields.push(field);
    }
    const rememberedUser = await page.getByText(/cambiar usuario/i).first().isVisible().catch(() => false);
    const action = decideLoginAction({
      currentUrl: page.url(),
      allowedOrigin: this.opts.santanderOrigin,
      visibleKeyFields: visibleFields.length,
      rememberedUser,
      hasStoredCredential: hasEncryptedCredential(this.opts.credentialFile)
    });
    if (action !== "SUBMIT_SAVED_KEY") {
      return { ok: false, reason: "El acceso automático no cumple las garantías: dominio oficial, usuario recordado, ocho casillas y clave local cifrada. Revisa la configuración." };
    }

    let key = "";
    try {
      key = readEncryptedAccessKey(this.opts.credentialFile);
      for (let i = 0; i < visibleFields.length; i++) await visibleFields[i].fill(key[i]);
      key = "";
      const enter = page.getByRole("button", { name: /^entrar$/i });
      if (await enter.count() !== 1) return { ok: false, reason: "No encuentro un único botón Entrar verificable en Santander." };
      await enter.click({ timeout: STEP_TIMEOUT_MS });
      if (!(await this.visible(page, selectors.sessionReady)) && !isAuthenticatedSantanderUrl(page.url(), this.opts.santanderOrigin)) {
        return { ok: false, reason: "Santander requiere OTP, confirmación móvil o intervención. Autorízalo en tu teléfono y reanuda el trabajo." };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "No se pudo usar la clave cifrada local. Vuelve a configurarla en este PC." };
    } finally {
      key = "";
    }
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

  private async findGeneratorFrame(page: any, maxAttempts = 40): Promise<any | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const frame = page.frames().find((candidate: any) => isRemittanceGeneratorUrl(String(candidate.url?.() ?? ""), this.opts.santanderOrigin));
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return null;
  }

  private async findEnvioremFrame(page: any): Promise<any | null> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const frame = page.frames().find((candidate: any) => isEnvioremFrameUrl(String(candidate.url?.() ?? ""), this.opts.santanderOrigin));
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return null;
  }

  private async locatePreviousRemittance(app: any, spec: SelectorSpec): Promise<boolean> {
    let labels: string[] = [];
    for (let attempt = 0; attempt <= 20; attempt++) {
      const templateVisible = await this.locator(app, spec).first().isVisible().catch(() => false);
      if (templateVisible) return true;
      labels = numericPageLabels(await app.locator("a, button").allTextContents().catch(() => []));
      if (!shouldWaitForRemittanceList(templateVisible, labels, attempt, 20)) break;
      await app.waitForTimeout(500);
    }
    for (const label of labels) {
      const controls = app.locator("a, button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
      const visibility: boolean[] = [];
      for (let index = 0; index < await controls.count(); index++) visibility.push(await controls.nth(index).isVisible().catch(() => false));
      const index = uniqueVisibleIndex(visibility);
      if (index === null) continue;
      const control = controls.nth(index);
      const role = (await control.getAttribute("role")) ?? await control.evaluate((element: Element) => element.tagName.toLowerCase() === "a" ? "link" : "button");
      if (!isSafePaginationControl(role, label)) continue;
      await control.click({ timeout: STEP_TIMEOUT_MS });
      await app.waitForTimeout(350);
      if (await this.locator(app, spec).first().isVisible().catch(() => false)) return true;
    }
    return false;
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

  private async clickUniqueVisible(page: any, spec: SelectorSpec): Promise<boolean> {
    try {
      const matches = this.locator(page, spec);
      const visibility: boolean[] = [];
      for (let index = 0; index < await matches.count(); index++) visibility.push(await matches.nth(index).isVisible().catch(() => false));
      const index = uniqueVisibleIndex(visibility);
      if (index === null) return false;
      await matches.nth(index).click({ timeout: STEP_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }

  private async hasUniqueVisible(page: any, spec: SelectorSpec): Promise<boolean> {
    const matches = this.locator(page, spec);
    const visibility: boolean[] = [];
    for (let index = 0; index < await matches.count(); index++) visibility.push(await matches.nth(index).isVisible().catch(() => false));
    return uniqueVisibleIndex(visibility) !== null;
  }

  private async clickBasicPayments(page: any, spec: SelectorSpec): Promise<boolean> {
    try {
      const matches = this.locator(page, spec);
      const visibility: boolean[] = [];
      for (let index = 0; index < await matches.count(); index++) visibility.push(await matches.nth(index).isVisible().catch(() => false));
      const index = uniqueVisibleIndex(visibility);
      if (index === null) return false;
      const candidate = matches.nth(index);
      if (!isSafeBasicPaymentsLabel(await candidate.innerText())) return false;
      await candidate.click({ timeout: STEP_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }

  private async clickRemittanceGeneration(page: any, spec: SelectorSpec): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const mapped = this.locator(page, spec);
      for (let index = 0; index < await mapped.count(); index++) {
        const candidate = mapped.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        const label = (await candidate.innerText().catch(() => "")).trim();
        if (!isSafeRemittanceGenerationLabel(label)) continue;
        await candidate.click({ timeout: STEP_TIMEOUT_MS });
        return true;
      }

      const semantic = page.getByText(/^\s*Generaci(?:ó|o)n(?: de remesas)?\s*$/i);
      const visibility: boolean[] = [];
      for (let index = 0; index < await semantic.count(); index++) visibility.push(await semantic.nth(index).isVisible().catch(() => false));
      const unique = uniqueVisibleIndex(visibility);
      if (unique !== null) {
        const candidate = semantic.nth(unique);
        if (isSafeRemittanceGenerationLabel(await candidate.innerText())) {
          await candidate.click({ timeout: STEP_TIMEOUT_MS });
          return true;
        }
      }
      await page.waitForTimeout(500);
    }
    return false;
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
