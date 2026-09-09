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
    expect(cron).not.toContain("processAllPendingMetaInvoiceRun");
  });

  it("collects PDFs produced by the visible Download PDF controls", () => {
    const collector = readFileSync(resolve(root, "chrome-extension/content/meta-billing.js"), "utf8");
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
});
