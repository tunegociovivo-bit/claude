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

export function shouldStartReconciliation(now: Date, lastSyncAt: Date | null, dailyAt: string, timeZone: string, forced: boolean): boolean {
  return forced || shouldRunDailyReconciliation(now, lastSyncAt, dailyAt, timeZone);
}

export function isForceReconciliationPending(forceRequestedAt: string | null, lastSyncAt: string | null): boolean {
  if (!forceRequestedAt) return false;
  const forceAt = new Date(forceRequestedAt).getTime();
  const syncedAt = lastSyncAt ? new Date(lastSyncAt).getTime() : Number.NEGATIVE_INFINITY;
  return Number.isFinite(forceAt) && forceAt > syncedAt;
}

export class FrameRefreshRequiredError extends Error {
  constructor(message = "Santander requiere volver a adquirir el iframe") {
    super(message);
    this.name = "FrameRefreshRequiredError";
  }
}

export async function browserValueOr<T>(operation: () => Promise<T>, _fallback: T): Promise<T> {
  return operation();
}

export async function clickAfterDismissingModal(page: any, locator: any, dismissModal?: () => Promise<void>): Promise<void> {
  try {
    await locator.click({ timeout: 8000 });
  } catch (error) {
    const message = String(error);
    if (!/(?:modal[\s\S]*intercepts pointer events|intercepts pointer events[\s\S]*modal)/i.test(message)) throw error;
    if (dismissModal) await dismissModal();
    else {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await locator.click({ timeout: 8000 });
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
      if (!(isDetachedFrameError(error) || error instanceof FrameRefreshRequiredError) || attempt === maxAttempts - 1) throw error;
    }
  }
  throw lastError;
}

export async function restoreRemittanceListFrame<TFrame>(
  navigateBack: () => Promise<void>,
  waitForRestoredFrame: () => Promise<TFrame | null>,
  reopenConsultation: () => Promise<TFrame>
): Promise<TFrame> {
  await navigateBack().catch(() => {});
  const restored = await waitForRestoredFrame().catch(() => null);
  return restored ?? reopenConsultation();
}

export async function acquireRemittanceListFrame<TFrame>(
  waitForCurrentFrame: () => Promise<TFrame | null>,
  reopenConsultation: () => Promise<TFrame>
): Promise<TFrame> {
  const current = await waitForCurrentFrame().catch(() => null);
  return current ?? reopenConsultation();
}

export async function reopenRemittanceListAtPage<TFrame>(
  reopenFirstPage: () => Promise<TFrame>,
  advancePage: (frame: TFrame, pageNumber: number) => Promise<TFrame>,
  pageIndex: number
): Promise<TFrame> {
  let frame = await reopenFirstPage();
  for (let pageNumber = 1; pageNumber <= pageIndex; pageNumber++) frame = await advancePage(frame, pageNumber);
  return frame;
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

export function effectiveReconciliationLastAttempt(
  failedAttempts: number,
  serverLastAttempt: Date | null,
  localLastAttempt: Date | null,
  zeroRetryResetConsumed = false
): Date | null {
  // El POST de resincronización pone el contador del HUB a cero. Esa orden
  // explícita debe saltarse también el enfriamiento que solo vive en memoria.
  return failedAttempts === 0 && !zeroRetryResetConsumed ? null : serverLastAttempt ?? localLastAttempt;
}

export function isDirectRemittanceList(text: string): boolean {
  return /Remesas de un acreedor/i.test(text);
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

export function isReconciliableSepaReceipt(receipt: SepaReceiptRow | null): receipt is SepaReceiptRow {
  return Boolean(receipt && receipt.status === "Orden liquidada" && receipt.amountCents > 0 && /^\d{4}$/.test(receipt.debtorIbanLast4));
}

export function parseSepaReceiptDebtor(text: string): string | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const holder = compact.match(/TITULAR\s+(.+?)\s+N[ÚU]MERO DE RECIBO/i)?.[1]?.trim();
  const concept = compact.match(/CONCEPTO\s+(.+?)\s+CUENTA DE ADEUDO/i)?.[1]?.trim();
  return [holder, concept].filter(Boolean).join(" · ") || null;
}

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

export function shouldImportAccountMovement(movement: BrowserMovement | null): movement is BrowserMovement {
  // El abono agregado de una remesa es el respaldo cuando Santander no deja
  // abrir el detalle de recibos. El HUB lo mantiene sin conciliar si la
  // coincidencia por fecha e importe no es única.
  return movement !== null;
}

export function isSantanderMovementRowText(text: string): boolean {
  return /\d{2}\/\d{2}\/\d{4}/.test(text)
    && /[+-]?\s*\d[\d.]*,\d{2}\s*EUR/i.test(text)
    && text.length < 1200;
}

export function selectReusableSantanderPage<T extends { url(): string }>(pages: T[], santanderOrigin: string): T | null {
  return pages.find((page) => {
    if (!isAuthenticatedSantanderUrl(page.url(), santanderOrigin)) return false;
    const pathname = new URL(page.url()).pathname;
    return pathname === "/paas/nwe/app/posglobal"
      || pathname.startsWith("/paas/nwe/app/cuentas/")
      || pathname === "/paas/nwe/app/portal/distribuidoras/remesas";
  }) ?? null;
}

export function hasVerifiedSantanderSessionText(text: string): boolean {
  return /posici[oó]n global|saldo disponible|mis cuentas|consulta de remesas|remesas de un acreedor/i.test(text)
    && !/sesi.n ha caducado|desconexi.n por inactividad/i.test(text);
}

export function isSafeRemittanceMenuLabel(label: string): boolean {
  return /^Remesas$/i.test(label.trim());
}

export function missingReceiptEvidenceMessage(pageText: string): string {
  return /sesi[oó]n ha caducado|desconexi[oó]n por inactividad/i.test(pageText)
    ? "Santander cerró la sesión durante la conciliación"
    : "Santander no mostró el detalle de recibos de una remesa contabilizada";
}

export function isReceiptListFrame(frameUrl: string, text: string, remittanceNumber: string): boolean {
  const expected = remittanceNumber.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const normalized = text.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return /\/rmtqry\/sepa-direct-debits\/receipts-list-sepa-debits(?:[/?#]|$)/i.test(frameUrl)
    && /Recibos de una remesa/i.test(text)
    && normalized.includes(expected);
}

export class SantanderReconciliationReader {
  constructor(private opts: { cdpUrl: string; santanderOrigin: string; credentialFile: string }) {}

  async scan(startsAt: Date): Promise<BrowserMovement[]> {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(this.opts.cdpUrl);
    let page: any = null;
    let ownsPage = false;
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("Chrome dedicado no está disponible");
      if (!await this.ensureAuthenticated(context)) throw new Error("No se pudo iniciar sesión en Santander con la credencial local");
      page = selectReusableSantanderPage(context.pages(), this.opts.santanderOrigin);
      if (!page) {
        page = await context.newPage();
        ownsPage = true;
      }
      let frame = await this.openRemittanceList(page);
      const unique = new Map<string, BrowserMovement>();
      const seenPages = new Set<string>();
      for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
        let rowTexts: string[] = [];
        for (let attempt = 0; attempt < 20; attempt++) {
          rowTexts = await runWithRefreshedFrame(
            async () => {
              const refreshedFrame = await acquireRemittanceListFrame(
                () => this.waitFrame(page, /Remesas de un acreedor/i, 60),
                () => this.openRemittanceList(page, pageIndex)
              );
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
            const row = await runWithRefreshedFrame(
              async () => {
                const refreshedFrame = await acquireRemittanceListFrame(
                  () => this.waitFrame(page, /Remesas de un acreedor/i, 60),
                  () => this.openRemittanceList(page, pageIndex)
                );
                frame = refreshedFrame;
                return refreshedFrame;
              },
              async (currentFrame) => {
                const currentRow = currentFrame.getByRole("row", { name: new RegExp(remittance.remittanceNumber.replace(/(.{4})/g, "$1\\s*").trim(), "i") }).first();
                await this.dismissBlockingModal(page, currentFrame);
                await clickAfterDismissingModal(page, currentRow.getByRole("button"), () => this.dismissBlockingModal(page, currentFrame));
                return currentRow;
              }
            );
          opened = true;
          const receipts = row.getByRole("link", { name: /^Recibos$/i });
          if (!await browserValueOr(() => receipts.isVisible(), false)) {
            const pageText = (await Promise.all(page.frames().map((candidate: any) => browserValueOr(() => candidate.locator("body").innerText(), "")))).join(" ");
            throw new Error(missingReceiptEvidenceMessage(pageText));
          }
          await receipts.click();
          const receiptFrame = await this.waitReceiptFrame(page, remittance.remittanceNumber);
          if (!receiptFrame) {
            const pageText = (await Promise.all(page.frames().map((candidate: any) => browserValueOr(() => candidate.locator("body").innerText(), "")))).join(" ");
            throw new Error(missingReceiptEvidenceMessage(pageText));
          }
          const receiptBody = await browserValueOr(() => receiptFrame.locator("body").innerText(), "");
          if (/sesi[oó]n ha caducado|desconexi[oó]n por inactividad/i.test(receiptBody)) throw new Error("Santander cerró la sesión durante la conciliación");
          let receiptTexts: string[] = [];
          let previousReceiptSignature = "";
          let stableReceiptReads = 0;
          for (let attempt = 0; attempt < 30; attempt++) {
            receiptTexts = await runWithRefreshedFrame(
              async () => {
                const refreshedReceiptFrame = await this.waitReceiptFrame(page, remittance.remittanceNumber);
                if (!refreshedReceiptFrame) throw new Error("Santander no restauró el detalle de recibos");
                return refreshedReceiptFrame;
              },
              (currentFrame) => browserValueOr(() => currentFrame.getByRole("row").allInnerTexts(), [])
            );
            const currentReceipt = receiptTexts.map(parseSepaReceiptRow).find(isReconciliableSepaReceipt);
            const receiptSignature = receiptTexts.join("|");
            stableReceiptReads = currentReceipt && receiptSignature === previousReceiptSignature ? stableReceiptReads + 1 : 0;
            previousReceiptSignature = receiptSignature;
            if (stableReceiptReads >= 2) break;
            await receiptFrame.waitForTimeout(500);
          }
          receiptTexts = await this.collectAllReceiptRows(page, remittance.remittanceNumber);
          for (const text of receiptTexts) {
            const receipt = parseSepaReceiptRow(text);
            if (!isReconciliableSepaReceipt(receipt)) continue;
            const debtorName = await this.readReceiptDebtorName(page, remittance.remittanceNumber, receipt.receiptNumber);
            const externalId = createHash("sha256").update(`${remittance.remittanceNumber}|${receipt.receiptNumber}`).digest("hex");
            unique.set(externalId, {
              externalId,
              bookedAt: remittance.dueAt,
              amountCents: receipt.amountCents,
              currency: "EUR",
              counterpartyName: debtorName,
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
              frame = await restoreRemittanceListFrame(
                async () => { await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }); },
                () => this.waitFrame(page, /Remesas de un acreedor/i, 60),
                () => this.openRemittanceList(page, pageIndex)
              );
            }
          }
        }
        // Santander puede ignorar el filtro de fechas; se recorren las páginas
        // y se corta si el control no cambia realmente el contenido.
        const pagination = await runWithRefreshedFrame(
          async () => {
            const refreshedFrame = await acquireRemittanceListFrame(
              () => this.waitFrame(page, /Remesas de un acreedor/i, 60),
              () => this.openRemittanceList(page, pageIndex)
            );
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
      if (page && ownsPage) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  private async ensureAuthenticated(context: any): Promise<boolean> {
    // A valid app tab wins over stale login copies. Submitting a second login
    // can invalidate Santander's already authenticated browser session.
    const activeSession: any = selectReusableSantanderPage(context.pages(), this.opts.santanderOrigin);
    if (activeSession) {
      const frameTexts = await Promise.all(activeSession.frames().map((frame: any) => frame.locator("body").innerText().catch(() => "")));
      const text = frameTexts.join("\n");
      if (hasVerifiedSantanderSessionText(text)) return true;
      await activeSession.goto(`${this.opts.santanderOrigin}/paas/loginnwe/?forcedLogout=true`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    }
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

    page = context.pages().find((candidate: any) => candidate.url().startsWith(`${this.opts.santanderOrigin}/paas/loginnwe/`));
    if (!page) {
      page = await context.newPage();
      await page.goto(`${this.opts.santanderOrigin}/paas/loginnwe/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    return this.submitStoredLogin(page);
  }

  private async openRemittanceList(page: any, pageIndex = 0): Promise<any> {
    await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/portal/distribuidoras/remesas`, { waitUntil: "domcontentloaded", timeout: 20000 });
    const directList = await this.waitFrame(page, /Remesas de un acreedor/i, 5);
    if (directList) {
      return reopenRemittanceListAtPage(
        async () => directList,
        (currentFrame, pageNumber) => this.advanceRemittancePage(page, currentFrame, pageNumber),
        pageIndex
      );
    }
    let frame = await this.waitFrame(page, /Herramienta para crear tus ficheros de remesas/i);
    if (!frame) {
      const remittanceMenu = page.locator("span.menu-item").filter({ hasText: /^Remesas$/i }).first();
      if (await remittanceMenu.isVisible().catch(() => false)) {
        const label = await remittanceMenu.innerText().catch(() => "");
        if (isSafeRemittanceMenuLabel(label)) await remittanceMenu.click();
        frame = await this.waitFrame(page, /Herramienta para crear tus ficheros de remesas/i);
      }
    }
    if (!frame) throw new Error("Santander no cargó el módulo de remesas");
    const consultation = frame.getByText(/Consulta el detalle, las liquidaciones y devoluciones de remesas procesadas/i).first();
    if (!await consultation.isVisible().catch(() => false)) throw new Error("Santander no mostró la consulta de remesas");
    await consultation.click();
    // Santander conserva el último filtro y en algunas sesiones omite la
    // pantalla "Tipo de remesa", entrando directamente al listado CORE.
    const directAfterConsultation = await this.waitFrame(page, /Remesas de un acreedor/i, 12);
    if (directAfterConsultation) {
      return reopenRemittanceListAtPage(
        async () => directAfterConsultation,
        (currentFrame, pageNumber) => this.advanceRemittancePage(page, currentFrame, pageNumber),
        pageIndex
      );
    }
    frame = await this.waitFrame(page, /Tipo de remesa/i, 120);
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
    return reopenRemittanceListAtPage(
      async () => frame,
      (currentFrame, pageNumber) => this.advanceRemittancePage(page, currentFrame, pageNumber),
      pageIndex
    );
  }

  private async advanceRemittancePage(page: any, frame: any, pageNumber: number): Promise<any> {
    let before = "";
    for (let attempt = 0; attempt < 20 && !before; attempt++) {
      before = (await browserValueOr(() => frame.getByRole("row").allInnerTexts(), [])).join("|");
      if (!before) await frame.waitForTimeout(300);
    }
    let next = frame.getByRole("button", { name: /^Ver siguientes$/i });
    if (await next.count() !== 1 || !await browserValueOr(() => next.isEnabled(), false)) {
      throw new Error(`Santander no permite recuperar la página ${pageNumber + 1} de remesas`);
    }
    await next.press("Enter");
    for (let attempt = 0; attempt < 20; attempt++) {
      await frame.waitForTimeout(400);
      const refreshed = await this.waitFrame(page, /Remesas de un acreedor/i, 5);
      if (!refreshed) continue;
      const after = (await browserValueOr(() => refreshed.getByRole("row").allInnerTexts(), [])).join("|");
      if (after && after !== before) return refreshed;
    }
    frame = await this.waitFrame(page, /Remesas de un acreedor/i, 10) ?? frame;
    next = frame.getByRole("button", { name: /^Ver siguientes$/i });
    if (await next.count() === 1 && await browserValueOr(() => next.isEnabled(), false)) {
      await next.click({ force: true });
      for (let attempt = 0; attempt < 20; attempt++) {
        await frame.waitForTimeout(400);
        const refreshed = await this.waitFrame(page, /Remesas de un acreedor/i, 5);
        if (!refreshed) continue;
        const after = (await browserValueOr(() => refreshed.getByRole("row").allInnerTexts(), [])).join("|");
        if (after && after !== before) return refreshed;
      }
    }
    throw new Error(`Santander no cambió a la página ${pageNumber + 1} al reconstruir la consulta`);
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

  private async collectAllReceiptRows(page: any, remittanceNumber: string): Promise<string[]> {
    const allRows: string[] = [];
    const seenPages = new Set<string>();
    let priorPageSignature = "";
    for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
      let rows: string[] = [];
      let previous = "";
      let stableReads = 0;
      for (let attempt = 0; attempt < 30; attempt++) {
        rows = await runWithRefreshedFrame(
          async () => {
            const current = await this.waitReceiptFrame(page, remittanceNumber);
            if (!current) throw new Error("Santander no restauró el detalle de recibos");
            return current;
          },
          (current) => browserValueOr(() => current.getByRole("row").allInnerTexts(), [])
        );
        const signature = rows.join("|");
        if (signature === priorPageSignature) {
          stableReads = 0;
          await page.waitForTimeout(500);
          continue;
        }
        stableReads = signature && signature === previous ? stableReads + 1 : 0;
        previous = signature;
        if (stableReads >= 2) break;
        await page.waitForTimeout(500);
      }
      const signature = rows.join("|");
      if (!signature || signature === priorPageSignature || seenPages.has(signature)) break;
      seenPages.add(signature);
      allRows.push(...rows);
      const advanced = await runWithRefreshedFrame(
        async () => {
          const current = await this.waitReceiptFrame(page, remittanceNumber);
          if (!current) throw new Error("Santander no restauró el detalle de recibos");
          return current;
        },
        async (current) => {
          const next = current.getByRole("button", { name: /^Ver siguientes$/i });
          if (await next.count() !== 1 || !await browserValueOr(() => next.isEnabled(), false)) return false;
          await next.press("Enter");
          return true;
        }
      );
      if (!advanced) break;
      priorPageSignature = signature;
      await page.waitForTimeout(800);
    }
    return allRows;
  }

  private async readReceiptDebtorName(page: any, remittanceNumber: string, receiptNumber: string): Promise<string | null> {
    const frame = await this.waitReceiptFrame(page, remittanceNumber);
    if (!frame) return null;
    const compactReceipt = receiptNumber.replace(/\s+/g, "");
    const row = frame.getByRole("row").filter({ hasText: new RegExp(compactReceipt.replace(/(.{4})/g, "$1\\s*").trim(), "i") }).first();
    if (!await row.isVisible().catch(() => false)) return null;
    await row.getByRole("button").click();
    const detail = frame.getByText(/^Detalle$/i).first();
    if (!await detail.isVisible().catch(() => false)) return null;
    await detail.click();
    const detailFrame = await this.waitFrame(page, /Detalle de un recibo/i, 60);
    if (!detailFrame) return null;
    const debtor = parseSepaReceiptDebtor(await detailFrame.locator("body").innerText().catch(() => ""));
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await this.waitReceiptFrame(page, remittanceNumber, 60);
    return debtor;
  }

  private async waitReceiptFrame(page: any, remittanceNumber: string, attempts = 50): Promise<any | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const frame of page.frames()) {
        const text = await frame.locator("body").innerText().catch(() => "");
        if (isReceiptListFrame(frame.url(), text, remittanceNumber)) return frame;
      }
      await page.waitForTimeout(300);
    }
    return null;
  }

  private async dismissBlockingModal(page: any, frame: any): Promise<void> {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    let modal: any = null;
    const candidateFrames = [frame, ...page.frames().filter((candidate: any) => candidate !== frame)];
    for (const candidateFrame of candidateFrames) {
      const modals = candidateFrame.locator(".modal");
      for (let index = await modals.count() - 1; index >= 0; index--) {
        const candidate = modals.nth(index);
        const blocksPointer = await candidate.evaluate((element: Element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden"
            && style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0;
        }).catch(() => false);
        if (blocksPointer) { modal = candidate; break; }
      }
      if (modal) break;
    }
    if (!modal) return;

    const semanticClose = modal.getByRole("button", { name: /^(Cerrar|Close|Volver)$/i });
    const structuralClose = modal.locator('button.close, [data-dismiss="modal"], button[aria-label*="cerrar" i], button[title*="cerrar" i]');
    if (await semanticClose.count() > 0) await semanticClose.first().click({ force: true });
    else if (await structuralClose.count() > 0) await structuralClose.first().click({ force: true });
    else {
      const disappeared = await modal.waitFor({ state: "hidden", timeout: 12000 }).then(() => true).catch(() => false);
      if (disappeared) return;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
      throw new FrameRefreshRequiredError("Santander dejó un diálogo bloqueante; se recargó la consulta de forma segura");
    }

    await page.waitForTimeout(300);
    if (await browserValueOr(() => modal.isVisible(), false)) throw new Error("Santander no cerró el diálogo de la remesa anterior");
  }

  private async scanAccountMovements(page: any, startsAt: Date): Promise<BrowserMovement[]> {
    await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/cuentas/subhome`, { waitUntil: "domcontentloaded", timeout: 20000 });
    let frame = await this.waitFrame(page, /Movimientos/i);
    if (!frame) throw new Error("Santander no cargó los movimientos de la cuenta");
    await this.applyDateFilter(frame, startsAt, new Date()).catch(() => {});
    const unique = new Map<string, BrowserMovement>();
    const seenPages = new Set<string>();
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      frame = await this.waitFrame(page, /Movimientos/i) ?? frame;
      const rows = await this.accountMovementRows(frame);
      const signature = rows.join("|");
      if (!signature || seenPages.has(signature)) break;
      seenPages.add(signature);
      for (const text of rows) {
        const movement = parseSantanderMovementText(text);
        if (!shouldImportAccountMovement(movement) || new Date(movement.bookedAt) < startsAt) continue;
        unique.set(movement.externalId, movement);
      }
      const next = frame.getByRole("button", { name: /^(Ver siguientes|Siguiente)$/i }).first();
      if (!await next.isVisible().catch(() => false) || !await next.isEnabled().catch(() => false)) break;
      await next.click();
      let advanced = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await page.waitForTimeout(400);
        const refreshed = await this.waitFrame(page, /Movimientos/i, 2);
        if (!refreshed) continue;
        try {
          const nextSignature = (await this.accountMovementRows(refreshed)).join("|");
          if (nextSignature && nextSignature !== signature) {
            frame = refreshed;
            advanced = true;
            break;
          }
        } catch {
          // Santander reemplaza el iframe durante la paginaciÃ³n; se vuelve a adquirir.
        }
      }
      if (!advanced) throw new Error("Santander no avanzÃ³ a la siguiente pÃ¡gina de movimientos");
    }
    return [...unique.values()];
  }

  private async accountMovementRows(frame: any): Promise<string[]> {
    return frame.locator("p").evaluateAll((nodes: Element[]) => nodes.map((node) => {
      let current: Element | null = node;
      for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
        const text = (current as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (isSantanderMovementRowText(text)) return text;
      }
      return "";
    }));
  }

  private async applyDateFilter(frame: any, startsAt: Date, endsAt: Date): Promise<void> {
    const format = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" }).format(date);
    await frame.getByRole("textbox", { name: /^Desde$/i }).fill(format(startsAt));
    await frame.getByRole("textbox", { name: /^Hasta$/i }).fill(format(endsAt));
    await frame.getByRole("button", { name: /^Aplicar filtros$/i }).click();
    await frame.waitForTimeout(500);
  }
}
