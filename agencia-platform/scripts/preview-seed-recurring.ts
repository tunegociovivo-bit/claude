/**
 * SEED DE PREVIEW — Facturas recurrentes (A+B+C+D+E0). SOLO para un entorno de
 * PREVIEW con base de datos EFÍMERA/AISLADA. Datos 100% ficticios y etiquetados
 * "DEMO" (sin PII real). NO llama a Holded ni a ningún sistema externo (el código
 * recurrente no tiene rutas externas).
 *
 * GUARDAS (para no tocar producción):
 *   - PREVIEW_SEED=on
 *   - PREVIEW_SEED_CONFIRM=yes-ephemeral-db
 *   - PREVIEW_WORKSPACE_ID=<id de un workspace demo YA creado en la preview>
 *   Si falta cualquiera, o NODE_ENV=production sin PREVIEW_ALLOW_PROD_SEED=on, aborta.
 *
 * Ejecutar en la PREVIEW:  PREVIEW_SEED=on PREVIEW_SEED_CONFIRM=yes-ephemeral-db \
 *   PREVIEW_WORKSPACE_ID=... npx tsx scripts/preview-seed-recurring.ts
 *
 * Muestra: plantillas active/paused/draft, plantilla legada (para backfill dry-run),
 * previews shadow y facturas legadas dispuestas para readiness ready/review/no_data.
 */
import { prisma } from "@/lib/db/prisma";

function abort(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[preview-seed] ABORTADO: ${msg}`);
  process.exit(1);
}

async function main() {
  if (process.env.PREVIEW_SEED !== "on") abort("PREVIEW_SEED != on");
  if (process.env.PREVIEW_SEED_CONFIRM !== "yes-ephemeral-db") abort("PREVIEW_SEED_CONFIRM incorrecto (esperado 'yes-ephemeral-db')");
  if (process.env.NODE_ENV === "production" && process.env.PREVIEW_ALLOW_PROD_SEED !== "on") abort("NODE_ENV=production sin PREVIEW_ALLOW_PROD_SEED=on");
  const ws = process.env.PREVIEW_WORKSPACE_ID;
  if (!ws) abort("PREVIEW_WORKSPACE_ID no definido");

  const exists = await prisma.workspace.findUnique({ where: { id: ws } });
  if (!exists) abort(`workspace ${ws} no existe en esta BD`);

  const now = new Date();
  const monthUTC = (offset: number, day = 1) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day));
  const lines = (cents: number) => [{ description: "DEMO — Cuota mensual de servicio", quantity: 1, unitPriceCents: cents, taxRate: 21, discountPct: 0 }];
  const totals = (net: number) => ({ subtotalCents: net, taxCents: Math.round(net * 0.21), totalCents: net + Math.round(net * 0.21) });

  // ── Plantillas Hub: active / paused / draft (source CSV_IMPORT) ──
  const t = (name: string, status: string, net: number, i: number) => ({
    workspaceId: ws,
    source: "CSV_IMPORT",
    externalId: `DEMO-${status}-${i}`,
    status,
    clientSnapshot: { name: `DEMO ${name} SL`, taxId: `B00000${i}0` },
    issuerSnapshot: { name: "DEMO Emisor SL", taxId: "B99999999" },
    lines: lines(net),
    currency: "EUR",
    ...totals(net),
    intervalMonths: 1,
    dayOfMonth: 1,
    anchorDate: monthUTC(-2),
    startDate: monthUTC(-2),
    nextIssueAt: monthUTC(1),
    paymentMethod: "TRANSFER",
    checksum: `demo-${status}-${i}`
  });
  await prisma.recurringInvoiceTemplate.createMany({
    data: [t("Acme", "active", 10000, 1), t("Beta", "active", 25000, 2), t("Gamma", "paused", 5000, 3), t("Delta", "draft", 8000, 4)],
    skipDuplicates: true
  });

  // ── Legado (para backfill dry-run): Invoice recurring=true + generadas ──
  const legacyTpl = await prisma.invoice.create({
    data: {
      workspaceId: ws,
      type: "NORMAL",
      status: "DRAFT",
      recurring: true,
      recurrenceConfig: { intervalMonths: 1, dayOfMonth: 1, nextRunAt: monthUTC(1).toISOString() },
      clientSnapshot: { name: "DEMO Legado SL", taxId: "B12341234" },
      issuerSnapshot: { name: "DEMO Emisor SL", taxId: "B99999999" },
      lines: lines(30000),
      currency: "EUR",
      ...totals(30000)
    }
  });

  // Backfilled Hub template (source LEGACY_INVOICE, externalId legacy:<id>) para
  // que readiness pueda cruzarla con las generadas por el legado.
  const backfilled = await prisma.recurringInvoiceTemplate.create({
    data: {
      workspaceId: ws,
      source: "LEGACY_INVOICE",
      externalId: `legacy:${legacyTpl.id}`,
      status: "draft",
      clientSnapshot: { name: "DEMO Legado SL", taxId: "B12341234" },
      lines: lines(30000),
      currency: "EUR",
      ...totals(30000),
      intervalMonths: 1,
      dayOfMonth: 1,
      anchorDate: monthUTC(-2),
      startDate: monthUTC(-2),
      nextIssueAt: monthUTC(0),
      paymentMethod: "TRANSFER",
      checksum: "demo-legacy"
    }
  });

  // Facturas REALES generadas por el legado (recurringSourceId) en -2 y -1 meses.
  const legNet = 30000;
  const legTot = totals(legNet).totalCents;
  await prisma.invoice.createMany({
    data: [
      { workspaceId: ws, type: "NORMAL", status: "ISSUED", series: "DEMO", number: "DEMO-1", issueDate: monthUTC(-2), currency: "EUR", ...totals(legNet), lines: lines(legNet), recurringSourceId: legacyTpl.id },
      { workspaceId: ws, type: "NORMAL", status: "ISSUED", series: "DEMO", number: "DEMO-2", issueDate: monthUTC(-1), currency: "EUR", ...totals(legNet), lines: lines(legNet), recurringSourceId: legacyTpl.id }
    ]
  });

  // ── Previews shadow para READINESS ──
  const preview = (offset: number, total: number) => ({
    workspaceId: ws,
    templateId: backfilled.id,
    occurrenceDate: monthUTC(offset),
    idempotencyKey: `${backfilled.id}:${monthUTC(offset).toISOString().slice(0, 10)}`,
    status: "preview",
    currency: "EUR",
    subtotalCents: Math.round(total / 1.21),
    taxCents: total - Math.round(total / 1.21),
    totalCents: total,
    payload: { demo: true, note: "DEMO preview shadow (no es factura)" }
  });
  // -2 coincide (ready), -1 difiere (not_ready). Quita la de -1 → review; borra
  // todas → no_data. (Documentado para el operador de la preview.)
  await prisma.recurringInvoicePreview.createMany({
    data: [preview(-2, legTot), preview(-1, legTot + 500)],
    skipDuplicates: true
  });

  // eslint-disable-next-line no-console
  console.log(
    `[preview-seed] OK en workspace ${ws}:\n` +
      `  - 4 plantillas Hub (2 active, 1 paused, 1 draft)\n` +
      `  - 1 plantilla legada (Invoice.recurring) + 1 backfilled + 2 facturas generadas\n` +
      `  - 2 previews shadow (readiness: -2 coincide, -1 difiere → 'not_ready')\n` +
      `  Casos readiness: quita la preview de -1 para 'review'; borra ambas para 'no_data'.\n` +
      `  Import CSV preview / backfill dry-run / pausa dry-run+frase / checklist Holded: se prueban desde la UI (nada externo).`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[preview-seed] error:", e);
  process.exit(1);
});
