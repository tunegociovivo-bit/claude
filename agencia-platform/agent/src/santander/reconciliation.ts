import { createHash } from "node:crypto";
import { isAuthenticatedSantanderUrl } from "./login.js";

export type BrowserMovement = {
  externalId: string;
  bookedAt: string;
  amountCents: number;
  currency: "EUR";
  counterpartyName: string | null;
  reference: string;
};

export function parseSantanderMovementText(text: string, now = new Date()): BrowserMovement | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const dateMatch = compact.match(/\b(\d{2})[\/.-](\d{2})(?:[\/.-](\d{2,4}))?\b/);
  const amountMatches = [...compact.matchAll(/([+-]?)\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*(?:EUR|€)/gi)];
  const amountMatch = amountMatches.at(-1);
  if (!dateMatch || !amountMatch || amountMatch[1] === "-") return null;
  const yearToken = dateMatch[3];
  const year = yearToken ? (yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken)) : now.getFullYear();
  const booked = new Date(Date.UTC(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), 12));
  if (!Number.isFinite(booked.getTime())) return null;
  const amountCents = Number(amountMatch[2].replace(/\./g, "")) * 100 + Number(amountMatch[3]);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;
  const reference = compact.slice(0, 500);
  const externalId = createHash("sha256").update(`${booked.toISOString()}|${amountCents}|${reference}`).digest("hex");
  const withoutDateAmount = compact.replace(dateMatch[0], " ").replace(amountMatch[0], " ").replace(/\s+/g, " ").trim();
  return { externalId, bookedAt: booked.toISOString(), amountCents, currency: "EUR", counterpartyName: withoutDateAmount.slice(0, 200) || null, reference };
}

export class SantanderReconciliationReader {
  constructor(private opts: { cdpUrl: string; santanderOrigin: string }) {}

  async scan(startsAt: Date): Promise<BrowserMovement[]> {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(this.opts.cdpUrl);
    let page: any = null;
    try {
      const context = browser.contexts()[0];
      if (!context) return [];
      const authenticated = context.pages().some((candidate: any) => isAuthenticatedSantanderUrl(candidate.url(), this.opts.santanderOrigin));
      if (!authenticated) return [];
      page = await context.newPage();
      await page.goto(`${this.opts.santanderOrigin}/paas/nwe/app/posglobal`, { waitUntil: "domcontentloaded", timeout: 20000 });
      let home: any = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        home = page.frames().find((frame: any) => frame.url().includes("/paas/posglobal/home"));
        if (home) break;
        await page.waitForTimeout(300);
      }
      if (!home) return [];
      const movements = home.getByText(/movimientos nuevos en .* cuentas/i).first();
      if (await movements.count()) await movements.click().catch(() => {});
      await page.waitForTimeout(1200);
      const candidates: string[] = await home.locator("tr:visible, li:visible, article:visible, [role=row]:visible").evaluateAll((elements: Element[]) =>
        elements.map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()).filter((text) => text.length >= 8 && text.length <= 700)
      ).catch(() => []);
      const unique = new Map<string, BrowserMovement>();
      for (const text of candidates) {
        const parsed = parseSantanderMovementText(text);
        if (parsed && new Date(parsed.bookedAt) >= startsAt) unique.set(parsed.externalId, parsed);
      }
      return [...unique.values()];
    } finally {
      if (page) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
