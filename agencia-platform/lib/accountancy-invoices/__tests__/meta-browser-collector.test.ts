import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Meta billing browser collector", () => {
  it("runs on the current Ads Manager billing domain", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "chrome-extension/manifest.json"), "utf8"));
    expect(manifest.host_permissions).toContain("https://adsmanager.facebook.com/*");
    expect(
      manifest.content_scripts.some((entry: { matches?: string[] }) =>
        entry.matches?.includes("https://adsmanager.facebook.com/*"),
      ),
    ).toBe(true);
  });

  it("leaves Meta run items for the authenticated browser collector", () => {
    const cron = readFileSync(resolve(root, "app/api/cron/accountancy-invoices/process/route.ts"), "utf8");
    const scheduler = readFileSync(resolve(root, "lib/cron/in-app-scheduler.ts"), "utf8");
    expect(cron).not.toContain("processAllPendingMetaInvoiceRun");
    expect(scheduler).not.toContain("processAllPendingMetaInvoiceRun");
  });

  it("opens the current Meta Business billing route for the requested account", () => {
    const collector = readFileSync(resolve(root, "lib/accountancy-invoices/collector.ts"), "utf8");
    expect(collector).toContain("https://business.facebook.com/latest/billing_hub/payment_activity/");
    expect(collector).toContain("payment_account_id=${encodeURIComponent(id)}");
  });

  it("routes Meta work to the assigned Chrome profile", () => {
    const route = readFileSync(resolve(root, "app/api/v1/admin/accountancy-invoices/agent/route.ts"), "utf8");
    const worker = readFileSync(resolve(root, "chrome-extension/background/service-worker.js"), "utf8");
    expect(route).toContain('client: { connectionRef: agentKey }');
    expect(route).toContain("accountancyBrowserAgent.upsert");
    expect(worker).toContain('headers.set("X-Hub-Browser-Agent"');
    expect(worker).toContain("getBrowserAgentIdentity");
  });

  it("leaves Google Ads run items for the authenticated browser collector", () => {
    const cron = readFileSync(resolve(root, "app/api/cron/accountancy-invoices/process/route.ts"), "utf8");
    const scheduler = readFileSync(resolve(root, "lib/cron/in-app-scheduler.ts"), "utf8");
    expect(cron).not.toContain("processAllPendingGoogleAdsInvoiceRun");
    expect(scheduler).not.toContain("processAllPendingGoogleAdsInvoiceRun");
  });

  it("selects the requested Google Ads customer and reads document download URLs", () => {
    const worker = readFileSync(resolve(root, "chrome-extension/background/service-worker.js"), "utf8");
    const collector = readFileSync(resolve(root, "chrome-extension/content/invoice-harvester.js"), "utf8");
    expect(worker).toContain("selectGoogleAdsCustomer(tab.id, item.externalAccountId)");
    expect(worker).toContain("selectGoogleIdentity(tab.id, item.connectionRef)");
    expect(worker).toContain("cambiar de cuenta de google|switch google account");
    expect(worker).toContain("periodKey: item.periodKey");
    expect(worker).toContain('input[aria-label*="CID"]');
    expect(worker).toContain("chrome.webNavigation.getAllFrames");
    expect(worker).toContain('allFrames: item.target.mode === "GOOGLE_ADS"');
    expect(collector).toContain('doc.querySelectorAll("[data-url]")');
    expect(collector).toContain("/payments\\/apis-secure\\/doc\\//");
    expect(collector).toContain("matchesPeriod(entry.text, message.periodKey)");
    expect(collector).toContain("await waitForGoogleBilling()");
  });

  it("collects PDFs produced by the visible Download PDF controls", () => {
    const collector = readFileSync(resolve(root, "chrome-extension/content/meta-billing.js"), "utf8");
    expect(collector).toContain("await waitForBillingRows()");
    expect(collector).toContain("pdf)=true");
    expect(collector).toContain("collectVisibleInvoiceButtons");
    expect(collector).toContain("capturedFiles");
  });

  it("suppresses the immediate ingest while a queued harvest owns the PDF", () => {
    const collector = readFileSync(resolve(root, "chrome-extension/content/meta-billing.js"), "utf8");
    expect(collector).toContain("harvestInProgress");
    expect(collector).toContain("if (!harvestInProgress)");
  });

  it("fails the queued item when Meta invoice ingestion fails", () => {
    const worker = readFileSync(resolve(root, "chrome-extension/background/service-worker.js"), "utf8");
    expect(worker).toContain("if (!ingested.ok) throw new Error");
  });

  it("does not report success until every visible receipt responds", () => {
    const collector = readFileSync(resolve(root, "chrome-extension/content/meta-billing.js"), "utf8");
    expect(collector).toContain("capturedFiles.length < controls.length");
    expect(collector).toContain("No respondieron todos los botones de descarga de Meta");
  });
});
