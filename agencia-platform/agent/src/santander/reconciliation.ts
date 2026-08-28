import { createHash } from "node:crypto";
import { decideLoginAction, isAuthenticatedSantanderUrl } from "./login.js";
import { hasEncryptedCredential, hasEncryptedUsername, readEncryptedAccessKey, readEncryptedUsername } from "../credential-store.js";

export type BrowserMovement = {
  externalId: string;
  bookedAt: string;
  amountCents: number;
  currency: "EUR";
  counterpartyName: string | null;
  reference: string;
  remittanceNumber?: string;
  debtorIbanLast4?: string;
  accountMasked?: string;
};

function localParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function shouldRunDailyReconciliation(now: Date, lastSyncAt: Date | null, dailyAt = "08:00", timeZone = "Europe/Madrid"): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const [hour, minute] = dailyAt.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  const current = localParts(now, timeZone);
  if (Number(current.hour) * 60 + Number(current.minute) < hour * 60 + minute) return false;
  if (!lastSyncAt || !Number.isFinite(lastSyncAt.getTime())) return true;
  const last = localParts(lastSyncAt, timeZone);
  return `${last.year}-${last.month}-${last.day}` !== `${current.year}-${current.month}-${current.day}`;
}

export type ReconciliationRetryDecision = "RUN" | "WAIT" | "EXHAUSTED";

export function isDetachedFrameError(error: unknown): boolean {
  return /frame was detached|detached frame|frame has been detached/i.test(String(error));
}

export async function browserValueOr<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDetachedFrameError(error)) throw error;
    return fallback;
  }
}

export async function runWithRefreshedFrame<TFrame, TResult>(
  acquireFrame: () => Promise<TFrame>,
  operation: (frame: TFrame) => Promise<TResult>,
  maxAttempts = 3
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const frame = await acquireFrame();
      return await operation(frame);
    } catch (error) {
      lastError = error;
      if (!isDetachedFrameError(error) || attempt === maxAttempts - 1) throw error;
    }
  }
  throw lastError;
}

export function reconciliationRetryDecision(now: Date, lastAttemptAt: Date | null, failedAttempts: number, timeZone = "Europe/Madrid", retryMinutes = 30): ReconciliationRetryDecision {
  if (!Number.isFinite(now.getTime())) return "WAIT";
  // El botón «Forzar resincronización» reinicia el contador. Debe prevalecer
  // sobre el enfriamiento de un fallo anterior para arrancar inmediatamente.
  if (failedAttempts <= 0) return "RUN";
  if (!lastAttemptAt || !Number.isFinite(lastAttemptAt.getTime())) return "RUN";
  const current = localParts(now, timeZone);
  const last = localParts(lastAttemptAt, timeZone);
  const sameDay = `${last.year}-${last.month}-${last.day}` === `${current.year}-${current.month}-${current.day}`;
  if (!sameDay) return "RUN";
  if (failedAttempts >= 3) return "EXHAUSTED";
  return now.getTime() - lastAttemptAt.getTime() >= retryMinutes * 60_000 ? "RUN" : "WAIT";
}

export type SepaRemittanceRow = { dueAt: string; amountCents: number; remittanceNumber: string; status: string };

export function parseSepaRemittanceRow(text: string): SepaRemittanceRow | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const match = compact.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+\d+\s+(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s+EUR\s+(\d{4}\s+\d{4}\s+\S+)/i);
  if (!match) return null;
  const amountCents = Number(match[4].replace(/\./g, "")) * 100 + Number(match[5]);
  const remittanceNumber = match[6].replace(/\s+/g, "");
  const status = compact.includes("Contabilizada") ? "Contabilizada" : compact.slice(-80);
  return { dueAt: `${match[3]}-${match[2]}-${match[1]}T12:00:00.000Z`, amountCents, remittanceNumber, status };
}

export type SepaReceiptRow = { receiptNumber: string; amountCents: number; debtorIbanLast4: string; status: string };

export function parseSepaReceiptRow(text: string): SepaReceiptRow | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const amount = compact.match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s+EUR/i);
  const receipt = compact.match(/^(\d{4}\s+\d{4}\s+\S+)/);
  const iban = compact.match(/IBAN\s+ES\d{2}(?:\s*\d{4}){5}/i);
  if (!amount || !receipt || !iban) return null;
  const ibanDigits = iban[0].replace(/\D/g, "");
  const status = /orden\s+liquidada/i.test(compact) ? "Orden liquidada" : (/devuelt/i.test(compact) ? "Orden devuelta" : "Otro");
  return {
    receiptNumber: receipt[1].replace(/\s+/g, ""),
    amountCents: Number(amount[1].replace(/\./g, "")) * 100 + Number(amount[2]),
    debtorIbanLast4: ibanDigits.slice(-4),
    status
  };
}

export function parseSantanderMovementText(text: string, now = new Date()): BrowserMovement | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const dateMatch = compact.match(/\b(\d{2})[\/.-](\d{2})(?:[\/.-](\d{2,4}))?\b/);
  const amountMatches = [...compact.matchAll(/([+-]?)\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*(?:EUR|€)/gi)];
  const amountMatch = amountMatches.find((match) => match[1] === "+" || match[1] === "-") ?? amountMatches[0];
  if (!dateMatch || !amountMatch) return null;
  const yearToken = dateMatch[3];
  const year = yearToken ? (yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken)) : now.getFullYear();
  const booked = new Date(Date.UTC(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), 12));
  if (!Number.isFinite(booked.getTime())) return null;
  const unsignedCents = Number(amountMatch[2].replace(/\./g, "")) * 100 + Number(amountMatch[3]);
  const amountCents = amountMatch[1] === "-" ? -unsignedCents : unsignedCents;
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) return null;
  const reference = compact.slice(0, 500);
  const externalId = createHash("sha256").update(`${booked.toISOString()}|${amountCents}|${reference}`).digest("hex");
  const withoutDateAmount = compact.replace(dateMatch[0], " ").replace(amountMatch[0], " ").replace(/\s+/g, " ").trim();
  return { externalId, bookedAt: booked.toISOString(), amountCents, currency: "EUR", counterpartyName: withoutDateAmount.slice(0, 200) || null, reference };
}

export class SantanderReconciliationReader {
  constructor(private opts: { cdpUrl: string; santanderOrigin: string; credentialFile: string }) {}

  async scan(startsAt: Date): Promise<BrowserMovement[]> {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(this.opts.cdpUrl);
    let page: any = null;
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("Chrome dedicado no está disponible");
      if (!await this.ensureAuthenticated(context)) throw new Error("No se pudo iniciar sesión en Santander con la credencial local");
      page = await context.newPage();
      await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/portal/distribuidoras/remesas`, { waitUntil: "domcontentloaded", timeout: 20000 });
      let frame = await this.waitFrame(page, /Herramienta para crear tus ficheros de remesas/i);
      if (!frame) throw new Error("Santander no cargó el módulo de remesas");
      const consultation = frame.getByText(/Consulta el detalle, las liquidaciones y devoluciones de remesas procesadas/i).first();
      if (!await consultation.isVisible().catch(() => false)) throw new Error("Santander no mostró la consulta de remesas");
      await consultation.click();
      frame = await this.waitFrame(page, /Tipo de remesa/i);
      if (!frame) throw new Error("Santander no cargó los filtros de remesas");
      await frame.getByRole("listbox", { name: /Elige una opción/i }).click();
      await frame.getByRole("option", { name: /^Domiciliaciones$/i }).click();
      await frame.getByRole("listbox", { name: /^Todos$/i }).click();
      await frame.getByRole("option", { name: /Domiciliaciones \(CORE\)/i }).click();
      await frame.getByRole("button", { name: /^Aplicar$/i }).click();
      frame = await this.waitFrame(page, /Cuenta abono[\s\S]*Identificador[\s\S]*Acreedor/i);
      if (!frame) throw new Error("Santander no cargó la cuenta de abono");
      const account = frame.getByText(/\d{4}\s+\d{4}\s+\d{10}/).first();
      const accountToggle = account.locator("xpath=ancestor::*[.//button][1]//button").first();
      await accountToggle.click();
      await frame.getByRole("button", { name: /^Remesas$/i }).click();
      frame = await this.waitFrame(page, /Remesas de un acreedor/i);
      if (!frame) throw new Error("Santander no cargó el listado de remesas");
      const unique = new Map<string, BrowserMovement>();
      const seenPages = new Set<string>();
      for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
        let rowTexts: string[] = [];
        for (let attempt = 0; attempt < 20; attempt++) {
          rowTexts = await runWithRefreshedFrame(
            async () => {
              const refreshedFrame = await this.waitFrame(page, /Remesas de un acreedor/i, 60);
              if (!refreshedFrame) throw new Error("Santander no restauró el listado de remesas para leerlo");
              frame = refreshedFrame;
              return refreshedFrame;
            },
            (currentFrame) => browserValueOr(() => currentFrame.getByRole("row").allInnerTexts(), [])
          );
          if (rowTexts.length > 1) break;
          await frame.waitForTimeout(500);
        }
        const pageSignature = rowTexts.join("|");
        if (!pageSignature || seenPages.has(pageSignature)) break;
        seenPages.add(pageSignature);
        const remittances = rowTexts.map(parseSepaRemittanceRow).filter((item): item is SepaRemittanceRow => Boolean(item))
          .filter((item) => item.status === "Contabilizada" && new Date(item.dueAt) >= startsAt);
        for (const remittance of remittances) {
          const aggregateId = createHash("sha256").update(`remittance|${remittance.remittanceNumber}`).digest("hex");
          unique.set(aggregateId, {
            externalId: aggregateId,
            bookedAt: remittance.dueAt,
            amountCents: remittance.amountCents,
            currency: "EUR",
            counterpartyName: null,
            reference: `Remesa SEPA ${remittance.remittanceNumber} · ${remittance.status}`,
            remittanceNumber: remittance.remittanceNumber
          });
          let opened = false;
          try {
          const row = frame.getByRole("row", { name: new RegExp(remittance.remittanceNumber.replace(/(.{4})/g, "$1\\s*").trim(), "i") }).first();
          await row.getByRole("button").click({ timeout: 8000 });
          opened = true;
          const receipts = row.getByRole("link", { name: /^Recibos$/i });
          if (!await browserValueOr(() => receipts.isVisible(), false)) continue;
          await receipts.click();
          const receiptFrame = await this.waitReceiptFrame(page, remittance.remittanceNumber);
          if (!receiptFrame) continue;
          const receiptBody = await browserValueOr(() => receiptFrame.locator("body").innerText(), "");
          if (/sesi[oó]n ha caducado|desconexi[oó]n por inactividad/i.test(receiptBody)) throw new Error("Santander cerró la sesión durante la conciliación");
          let receiptTexts: string[] = [];
          for (let attempt = 0; attempt < 30; attempt++) {
            receiptTexts = await runWithRefreshedFrame(
              async () => {
                const refreshedReceiptFrame = await this.waitReceiptFrame(page, remittance.remittanceNumber);
                if (!refreshedReceiptFrame) throw new Error("Santander no restauró el detalle de recibos");
                return refreshedReceiptFrame;
              },
              (currentFrame) => browserValueOr(() => currentFrame.getByRole("row").allInnerTexts(), [])
            );
            const currentReceipt = receiptTexts.map(parseSepaReceiptRow).find((item) => item?.amountCents === remittance.amountCents);
            if (currentReceipt) break;
            await receiptFrame.waitForTimeout(500);
          }
          for (const text of receiptTexts) {
            const receipt = parseSepaReceiptRow(text);
            if (!receipt || receipt.status !== "Orden liquidada" || receipt.amountCents !== remittance.amountCents) continue;
            const externalId = createHash("sha256").update(`${remittance.remittanceNumber}|${receipt.receiptNumber}`).digest("hex");
            unique.set(externalId, {
              externalId,
              bookedAt: remittance.dueAt,
              amountCents: receipt.amountCents,
              currency: "EUR",
              counterpartyName: null,
              reference: `Remesa SEPA ${remittance.remittanceNumber} · Recibo ${receipt.receiptNumber} · ${receipt.status}`,
              accountMasked: `****${receipt.debtorIbanLast4}`,
              remittanceNumber: remittance.remittanceNumber,
              debtorIbanLast4: receipt.debtorIbanLast4
            });
          }
          } catch (error) {
            throw error;
          } finally {
            if (opened) {
              await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
              const refreshedFrame = await this.waitFrame(page, /Remesas de un acreedor/i, 60);
              if (!refreshedFrame) throw new Error("Santander no restauró el listado de remesas tras consultar un recibo");
              frame = refreshedFrame;
            }
          }
        }
        // Santander puede ignorar el filtro de fechas; se recorren las páginas
        // y se corta si el control no cambia realmente el contenido.
        const pagination = await runWithRefreshedFrame(
          async () => {
            const refreshedFrame = await this.waitFrame(page, /Remesas de un acreedor/i, 60);
            if (!refreshedFrame) throw new Error("Santander no restauró el listado de remesas para paginar");
            frame = refreshedFrame;
            return refreshedFrame;
          },
          async (currentFrame) => {
            const next = currentFrame.getByRole("button", { name: /^Ver siguientes$/i });
            if (await next.count() !== 1 || !await browserValueOr(() => next.isEnabled(), false)) return false;
            await next.press("Enter");
            await currentFrame.waitForTimeout(800);
            let nextRows = await browserValueOr(() => currentFrame.getByRole("row").allInnerTexts(), []);
            if (nextRows.join("|") === pageSignature) {
              await next.click({ force: true });
              await currentFrame.waitForTimeout(800);
              nextRows = await browserValueOr(() => currentFrame.getByRole("row").allInnerTexts(), []);
            }
            return nextRows.join("|") !== pageSignature;
          }
        );
        if (!pagination) break;
      }
      try {
        for (const movement of await this.scanAccountMovements(page, startsAt)) unique.set(movement.externalId, movement);
      } catch (error) {
        // Santander sirve Cuenta y Remesas como aplicaciones independientes.
        // Un fallo de Cuenta no debe descartar recibos SEPA ya verificados.
        if (unique.size === 0) throw error;
      }
      return [...unique.values()];
    } finally {
      if (page) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  private async ensureAuthenticated(context: any): Promise<boolean> {
    // Una pantalla de login/reconexión es la señal autoritativa. Puede coexistir
    // con pestañas internas cuya URL parece autenticada pero cuya sesión caducó.
    const loginPages = context.pages().filter((candidate: any) => candidate.url().startsWith(`${this.opts.santanderOrigin}/paas/loginnwe/`));
    let page = loginPages.at(-1) ?? null;
    if (page) {
      // Los cierres por inactividad pueden dejar varias copias antiguas del
      // login. Conservamos solo la más reciente para no rellenar un DOM obsoleto.
      for (const stalePage of loginPages.slice(0, -1)) await stalePage.close().catch(() => {});
      await page.goto(`${this.opts.santanderOrigin}/paas/loginnwe/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      return this.submitStoredLogin(page);
    }

    const authenticated = context.pages().find((candidate: any) => isAuthenticatedSantanderUrl(candidate.url(), this.opts.santanderOrigin));
    if (authenticated) {
      const text = await authenticated.locator("body").innerText().catch(() => "");
      if (!/sesi.n ha caducado|desconexi.n por inactividad/i.test(text)) return true;
      await authenticated.goto(`${this.opts.santanderOrigin}/paas/loginnwe/?forcedLogout=true`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    }
    page = context.pages().find((candidate: any) => candidate.url().startsWith(`${this.opts.santanderOrigin}/paas/loginnwe/`));
    if (!page) {
      page = await context.newPage();
      await page.goto(`${this.opts.santanderOrigin}/paas/loginnwe/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    return this.submitStoredLogin(page);
  }

  private async submitStoredLogin(page: any): Promise<boolean> {
    const reconnect = page.getByRole("button", { name: /^volver a conectar$/i });
    if (await reconnect.count() === 1 && await reconnect.isVisible().catch(() => false)) {
      await reconnect.click();
      await page.waitForTimeout(500);
    }
    const fields = page.locator('input[type="text"], input:not([type])');
    let visible: any[] = [];
    let rememberedUser = false;
    // El formulario de clave se monta de forma asíncrona. Esperar evita
    // clasificar como desconocida una pantalla oficial todavía incompleta.
    for (let attempt = 0; attempt < 20; attempt++) {
      visible = [];
      for (let index = 0; index < await fields.count(); index++) {
        const field = fields.nth(index);
        if (await field.isVisible().catch(() => false)) visible.push(field);
      }
      rememberedUser = await page.getByText(/cambiar usuario/i).first().isVisible().catch(() => false);
      if ((visible.length === 8 && rememberedUser) || visible.length === 9) break;
      await page.waitForTimeout(500);
    }
    const action = decideLoginAction({
      currentUrl: page.url(), allowedOrigin: this.opts.santanderOrigin, visibleKeyFields: visible.length, rememberedUser,
      hasStoredCredential: hasEncryptedCredential(this.opts.credentialFile), hasStoredUsername: hasEncryptedUsername(this.opts.credentialFile)
    });
    if (action === "PAUSE") {
      throw new Error(`Formato de acceso Santander no reconocido (${visible.length} campos visibles; usuario recordado: ${rememberedUser ? "sí" : "no"})`);
    }
    let key = "";
    let username = "";
    try {
      key = readEncryptedAccessKey(this.opts.credentialFile);
      const keyFields = action === "SUBMIT_SAVED_CREDENTIALS" ? visible.slice(1) : visible;
      if (action === "SUBMIT_SAVED_CREDENTIALS") {
        username = readEncryptedUsername(this.opts.credentialFile);
        await visible[0].fill(username);
      }
      for (let index = 0; index < keyFields.length; index++) await keyFields[index].fill(key[index]);
      key = "";
      username = "";
      const enter = page.getByRole("button", { name: /^entrar$/i });
      if (await enter.count() !== 1) return false;
      await enter.click();
      for (let attempt = 0; attempt < 40; attempt++) {
        if (isAuthenticatedSantanderUrl(page.url(), this.opts.santanderOrigin)) return true;
        await page.waitForTimeout(500);
      }
      return false;
    } catch {
      return false;
    } finally {
      key = "";
      username = "";
    }
  }

  private async waitFrame(page: any, pattern: RegExp, attempts = 40): Promise<any | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const frame of page.frames()) {
        const text = await frame.locator("body").innerText().catch(() => "");
        if (pattern.test(text)) return frame;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  private async waitReceiptFrame(page: any, remittanceNumber: string, attempts = 50): Promise<any | null> {
    const expected = remittanceNumber.replace(/[^a-z0-9]/gi, "").toUpperCase();
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const frame of page.frames()) {
        const text = await frame.locator("body").innerText().catch(() => "");
        const normalized = text.replace(/[^a-z0-9]/gi, "").toUpperCase();
        if (/Recibos de una remesa/i.test(text) && normalized.includes(expected)) return frame;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  private async scanAccountMovements(page: any, startsAt: Date): Promise<BrowserMovement[]> {
    await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/cuentas/subhome`, { waitUntil: "domcontentloaded", timeout: 20000 });
    const frame = await this.waitFrame(page, /Movimientos/i);
    if (!frame) throw new Error("Santander no cargó los movimientos de la cuenta");
    const rows: string[] = await frame.locator("p").evaluateAll((nodes: Element[]) => nodes.map((node) => {
      let current: Element | null = node;
      for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
        const text = (current as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (/\d{2}\/\d{2}\/\d{4}/.test(text) && /[+-]\s*\d[\d.]*,\d{2}\s*EUR/i.test(text) && text.length < 1200) return text;
      }
      return "";
    })).catch(() => []);
    const unique = new Map<string, BrowserMovement>();
    for (const text of rows) {
      const movement = parseSantanderMovementText(text);
      if (!movement || new Date(movement.bookedAt) < startsAt) continue;
      // Los abonos SEPA se concilian desde el detalle de recibos, nunca desde el agregado de cuenta.
      if (movement.amountCents > 0 && /Emision Remesa Sepa Sdd/i.test(movement.reference)) continue;
      unique.set(movement.externalId, movement);
    }
    return [...unique.values()];
  }

  private async applyDateFilter(frame: any, startsAt: Date, endsAt: Date): Promise<void> {
    const format = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" }).format(date);
    await frame.getByRole("textbox", { name: /^Desde$/i }).fill(format(startsAt));
    await frame.getByRole("textbox", { name: /^Hasta$/i }).fill(format(endsAt));
    await frame.getByRole("button", { name: /^Aplicar filtros$/i }).click();
    await frame.waitForTimeout(500);
  }
}
