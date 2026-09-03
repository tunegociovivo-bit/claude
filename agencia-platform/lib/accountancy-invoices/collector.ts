type CollectorInput = {
  source: string;
  externalAccountId?: string | null;
  periodFrom: string | Date;
  periodTo: string | Date;
};

export type CollectorTarget = { mode: "META" | "HOLDED" | "GOOGLE_ADS"; url: string };

export function buildCollectorTarget(input: CollectorInput): CollectorTarget {
  const id = String(input.externalAccountId || "").trim();
  if (input.source === "META") {
    if (!/^\d{6,25}$/.test(id)) throw new Error("Identificador de cuenta Meta no válido");
    const from = new Date(input.periodFrom);
    const to = new Date(input.periodTo);
    const start = Math.floor(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) / 1000);
    const endExclusive = Math.floor(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1) / 1000);
    return {
      mode: "META",
      url: `https://adsmanager.facebook.com/adsmanager/billing_hub/payment_activity?asset_id=${encodeURIComponent(id)}&date=${start}_${endExclusive}`
    };
  }
  if (input.source === "HOLDED") return { mode: "HOLDED", url: "https://app.holded.com/sales/revenue" };
  if (input.source === "GOOGLE_ADS") {
    let url: URL;
    try { url = new URL(id); } catch { throw new Error("Configura la URL de facturación de Google Ads para esta cuenta"); }
    if (url.protocol !== "https:" || url.hostname !== "ads.google.com" || !url.pathname.includes("/billing/")) {
      throw new Error("Configura una URL de facturación válida de Google Ads");
    }
    return { mode: "GOOGLE_ADS", url: url.toString() };
  }
  throw new Error(`Medio no automatizable: ${input.source}`);
}

export function sanitizeCollectorFilename(filename: string) {
  const leaf = filename.replace(/\\/g, "/").split("/").pop() || "factura.pdf";
  if (!/\.pdf$/i.test(leaf)) throw new Error("Solo se admiten facturas PDF");
  return leaf.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "factura.pdf";
}
