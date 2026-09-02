import { prisma } from "@/lib/db/prisma";
import { getPreviousMonthPeriod, getRunHealth } from "./domain";

export const DEFAULT_RECIPIENTS = ["info@negociovivo.com"];
export const SOURCES = ["HOLDED", "META", "GOOGLE_ADS", "BANK"] as const;

const DEFAULT_CLIENTS = [
  ["Holded - todas las facturas", "HOLDED", "holded-sales-revenue"],
  ["Automatic Choice y Campañas Negocio Vivo", "META", "290451863303865"],
  ["RS Avocat 2026 NV", "META", "1477993670483838"],
  ["RSADVOCATS", "META", "911251981746237"],
  ["EUROSISTEMAS", "META", "304176041819854"],
  ["LA MARISCÁ", "META", "585809849125581"],
  ["NEGOCIO VIVO", "META", "2074249599540370"],
  ["David Díaz Ríos", "META", "1906884993251"],
  ["Mudanzas Reva", "GOOGLE_ADS", "384-789-9827"],
  ["Taxi Grande Málaga", "GOOGLE_ADS", "taxi-grande-malaga"],
  ["Tecnoidentia NV", "GOOGLE_ADS", "708-187-4860"],
  ["Automatic Choice", "GOOGLE_ADS", "automatic-choice"],
  ["Mudanzas Lorena", "GOOGLE_ADS", "mudanzas-lorena"],
  ["Eroski Franquicias", "GOOGLE_ADS", "196-147-6671"],
  ["NV - México", "GOOGLE_ADS", "631-103-4413"],
  ["LATAM", "GOOGLE_ADS", "660-810-9819"]
] as const;

export async function ensureDefaultAccountancyClients(workspaceId: string) {
  await prisma.accountancyInvoiceClient.createMany({
    data: DEFAULT_CLIENTS.map(([name, source, externalAccountId]) => ({ workspaceId, name, source, externalAccountId })),
    skipDuplicates: true
  });
  await prisma.accountancyInvoiceSchedule.upsert({
    where: { workspaceId },
    create: { workspaceId, recipients: DEFAULT_RECIPIENTS },
    update: {}
  });
}

export async function createAccountancyInvoiceRun(workspaceId: string, trigger: "MANUAL" | "SCHEDULED", now = new Date()) {
  const period = getPreviousMonthPeriod(now);
  const clients = await prisma.accountancyInvoiceClient.findMany({ where: { workspaceId, enabled: true }, orderBy: [{ source: "asc" }, { name: "asc" }] });
  const schedule = await prisma.accountancyInvoiceSchedule.findUnique({ where: { workspaceId } });
  return prisma.accountancyInvoiceRun.create({
    data: {
      workspaceId,
      periodKey: period.key,
      periodFrom: new Date(`${period.from}T00:00:00.000Z`),
      periodTo: new Date(`${period.to}T23:59:59.999Z`),
      trigger,
      recipients: schedule?.recipients ?? DEFAULT_RECIPIENTS,
      items: { create: clients.map((client) => ({ clientId: client.id, clientName: client.name, source: client.source })) }
    },
    include: { items: true }
  });
}

export async function refreshRunStatus(runId: string) {
  const run = await prisma.accountancyInvoiceRun.findUnique({ where: { id: runId }, include: { items: true } });
  if (!run) throw new Error("Ejecución no encontrada");
  const status = getRunHealth(run.items);
  return prisma.accountancyInvoiceRun.update({
    where: { id: runId },
    data: { status, ...(status === "SUCCESS" || status === "PARTIAL" || status === "FAILED" ? { finishedAt: new Date() } : {}) }
  });
}
