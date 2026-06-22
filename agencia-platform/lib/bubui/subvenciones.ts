/**
 * Cazador de Subvenciones → comercios de Bubui.
 *
 * Flujo:
 *  1. Entra (o se re-escanea) un comercio → `scanBusinessForSubvenciones`
 *     busca ayudas de su nicho con el motor IA del Cazador y, si hay
 *     novedades, crea una PROPUESTA pendiente + avisa al equipo.
 *  2. El admin revisa en su panel y aprueba → `approveAndSendProposal`
 *     envía las subvenciones al comercio por WhatsApp + email con un
 *     enlace de validación de un clic.
 *  3. El comercio pulsa "quiero que me lo gestionéis" →
 *     `acceptProposalByToken` marca la propuesta como aceptada y avisa
 *     al equipo (queda como oportunidad para la agencia).
 *
 * Bubui no es multi-workspace: para la IA y el WhatsApp usamos el primer
 * workspace (Negocio Vivo), igual que `team-notify`.
 */
import { prisma } from "@/lib/db/prisma";
import { matchForBubuiBusiness, type ClientMatch } from "@/lib/subvenciones/match";
import { notifyTeam } from "@/lib/bubui/team-notify";

export type SubvProposalMatch = {
  id: string;
  titulo: string;
  motivo: string;
  requisitos: string;
  fitScore: number;
  probabilidad: number | null; // 0-100 prob. estimada de concesión
  importeTotal: number | null;
  fechaFin: string | null; // ISO
  urlBases: string | null;
};

const ACTIVE_STATUSES = ["pending", "sent", "accepted"]; // no re-proponer lo ya vivo

/** Base del hub donde viven las páginas públicas /p/... */
function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://hub.negociovivo.app").replace(/\/+$/, "");
}

async function firstWorkspaceId(): Promise<string | null> {
  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return ws?.id ?? null;
}

/** Días que faltan para el cierre (negativo si ya pasó, null si sin fecha). */
export function daysUntilClose(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Orden de visualización: lo que cierra pronto (<=30 días) primero, por
// cercanía de cierre; el resto por relevancia (fitScore). Así no se pierde
// una ayuda a punto de cerrar entre las de mucho plazo.
function byUrgencyThenFit(a: SubvProposalMatch, b: SubvProposalMatch): number {
  const da = daysUntilClose(a.fechaFin);
  const db = daysUntilClose(b.fechaFin);
  const au = da != null && da >= 0 && da <= 30;
  const bu = db != null && db >= 0 && db <= 30;
  if (au && bu) return (da as number) - (db as number);
  if (au) return -1;
  if (bu) return 1;
  return b.fitScore - a.fitScore;
}

function toSnapshot(m: ClientMatch): SubvProposalMatch {
  return {
    id: m.id,
    titulo: m.titulo,
    motivo: m.motivo,
    requisitos: m.requisitos,
    fitScore: m.fitScore,
    probabilidad: m.probabilidad ?? null,
    importeTotal: m.importeTotal ?? null,
    fechaFin: m.fechaFin ? new Date(m.fechaFin).toISOString() : null,
    urlBases: m.urlBases ?? null
  };
}

/**
 * Escanea UN comercio. Crea una propuesta pendiente solo si encuentra
 * subvenciones NUEVAS (no propuestas ya). Marca siempre subvLastScanAt.
 */
export async function scanBusinessForSubvenciones(
  businessId: string,
  opts?: { force?: boolean }
): Promise<{ created: boolean; count: number; proposalId?: string }> {
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, category: true, businessType: true, city: true,
      province: true, active: true
    }
  });
  if (!business || !business.active) return { created: false, count: 0 };

  const workspaceId = await firstWorkspaceId();
  if (!workspaceId) return { created: false, count: 0 };

  // Dedup: convocatorias ya propuestas/enviadas/aceptadas a este comercio.
  const prev = await prisma.bubuiSubvencionProposal.findMany({
    where: { businessId, status: { in: ACTIVE_STATUSES } },
    select: { matches: true }
  });
  const already = new Set<string>();
  for (const p of prev) {
    for (const m of (p.matches as unknown as SubvProposalMatch[]) ?? []) already.add(m.id);
  }

  let matches: ClientMatch[] = [];
  try {
    matches = await matchForBubuiBusiness(workspaceId, business, { force: opts?.force });
  } catch (e) {
    // La IA puede no estar disponible: marcamos el escaneo y salimos sin romper.
    await prisma.bubuiBusiness.update({ where: { id: businessId }, data: { subvLastScanAt: new Date() } }).catch(() => {});
    throw e;
  }

  const fresh = matches.filter((m) => !already.has(m.id));
  await prisma.bubuiBusiness.update({ where: { id: businessId }, data: { subvLastScanAt: new Date() } });

  if (fresh.length === 0) return { created: false, count: 0 };

  const snapshot = fresh.map(toSnapshot).sort(byUrgencyThenFit);
  const proposal = await prisma.bubuiSubvencionProposal.create({
    data: { businessId, status: "pending", matches: snapshot as any }
  });

  // Aviso al equipo para que lo revise.
  const top = snapshot.slice(0, 5).map((m) => `• ${m.titulo}${m.importeTotal ? ` (hasta ${Math.round(m.importeTotal).toLocaleString("es-ES")} €)` : ""}`).join("\n");
  await notifyTeam({
    subject: `Subvenciones para revisar — ${business.name}`,
    text: `El Cazador ha encontrado ${snapshot.length} ayuda(s) para "${business.name}" (${business.category ?? "—"}).\n\n${top}\n\nRevísalas y apruébalas en: ${appBase()}/admin/subvenciones`
  }).catch(() => {});

  return { created: true, count: snapshot.length, proposalId: proposal.id };
}

/**
 * Barrido para el cron: comercios activos nunca escaneados o con escaneo
 * antiguo (>7 días). Cubre tanto las altas nuevas como el re-escaneo
 * periódico (salen ayudas nuevas cada semana).
 */
export async function runBubuiSubvencionScan(limit = 40): Promise<{ scanned: number; proposalsCreated: number }> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const businesses = await prisma.bubuiBusiness.findMany({
    where: {
      active: true,
      OR: [{ subvLastScanAt: null }, { subvLastScanAt: { lt: weekAgo } }]
    },
    orderBy: { subvLastScanAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true }
  });

  let proposalsCreated = 0;
  for (const b of businesses) {
    try {
      const r = await scanBusinessForSubvenciones(b.id);
      if (r.created) proposalsCreated++;
    } catch (e) {
      console.warn("[bubui subvenciones scan]", b.id, (e as Error).message);
    }
  }
  return { scanned: businesses.length, proposalsCreated };
}

/** Dispara un escaneo en segundo plano (no bloquea la request de alta). */
export function triggerScanInBackground(businessId: string): void {
  scanBusinessForSubvenciones(businessId).catch((e) =>
    console.warn("[bubui subvenciones trigger]", businessId, (e as Error)?.message ?? e)
  );
}

// ── Envío al comercio (tras OK del admin) ───────────────────────────
function buildMessages(businessName: string, matches: SubvProposalMatch[], url: string) {
  const lines = matches.map((m) => {
    const importe = m.importeTotal ? ` — hasta ${Math.round(m.importeTotal).toLocaleString("es-ES")} €` : "";
    const d = daysUntilClose(m.fechaFin);
    const cierre =
      d != null && d >= 0 && d <= 15
        ? ` ⏳ cierra en ${d} día${d === 1 ? "" : "s"}`
        : m.fechaFin
        ? ` (cierra ${new Date(m.fechaFin).toLocaleDateString("es-ES")})`
        : "";
    return `• ${m.titulo}${importe}${cierre}`;
  });
  const text =
    `Hola ${businessName} 👋\n\n` +
    `Desde Bubui hemos encontrado ${matches.length} subvención(es) que encajan con tu negocio:\n\n` +
    `${lines.join("\n")}\n\n` +
    `Si quieres, te las gestionamos nosotros (sin que tengas que pelearte con el papeleo). ` +
    `Confirma con un clic aquí:\n${url}`;

  const itemsHtml = matches
    .map((m) => {
      const importe = m.importeTotal ? `<span style="color:#059669;font-weight:600"> — hasta ${Math.round(m.importeTotal).toLocaleString("es-ES")} €</span>` : "";
      const d = daysUntilClose(m.fechaFin);
      const cierre =
        d != null && d >= 0 && d <= 15
          ? `<span style="color:#dc2626;font-weight:600"> ⏳ cierra en ${d} día${d === 1 ? "" : "s"}</span>`
          : m.fechaFin
          ? `<span style="color:#64748b"> (cierra ${new Date(m.fechaFin).toLocaleDateString("es-ES")})</span>`
          : "";
      const motivo = m.motivo ? `<div style="color:#475569;font-size:13px;margin-top:2px">${m.motivo}</div>` : "";
      return `<li style="margin-bottom:10px"><strong>${m.titulo}</strong>${importe}${cierre}${motivo}</li>`;
    })
    .join("");
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">` +
    `<h2 style="color:#0f172a">💶 Subvenciones para ${businessName}</h2>` +
    `<p style="color:#334155">Desde <strong>Bubui</strong> hemos encontrado estas ayudas que encajan con tu negocio:</p>` +
    `<ul style="color:#0f172a;padding-left:18px">${itemsHtml}</ul>` +
    `<p style="color:#334155">Si quieres, <strong>te las gestionamos nosotros</strong>. Confírmalo con un clic:</p>` +
    `<p><a href="${url}" style="display:inline-block;background:#db2777;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Sí, quiero que me lo gestionéis</a></p>` +
    `<p style="color:#94a3b8;font-size:12px">Si el botón no funciona, copia este enlace: ${url}</p>` +
    `</div>`;
  return { text, html };
}

/** Aprueba una propuesta pendiente y la envía al comercio (WhatsApp + email). */
export async function approveAndSendProposal(
  proposalId: string
): Promise<{ ok: boolean; whatsapp: boolean; email: boolean; error?: string }> {
  const proposal = await prisma.bubuiSubvencionProposal.findUnique({
    where: { id: proposalId },
    include: {
      business: { select: { id: true, name: true, ownerEmail: true, ownerPhone: true, phone: true } }
    }
  });
  if (!proposal) return { ok: false, whatsapp: false, email: false, error: "Propuesta no encontrada" };
  if (proposal.status !== "pending") return { ok: false, whatsapp: false, email: false, error: "La propuesta ya fue procesada" };

  const matches = (proposal.matches as unknown as SubvProposalMatch[]) ?? [];
  const url = `${appBase()}/p/subvencion/${proposal.token}`;
  const { text, html } = buildMessages(proposal.business.name, matches, url);

  let whatsapp = false;
  let email = false;

  // WhatsApp (proveedor activo del primer workspace, como NV Leads Pro).
  try {
    const phoneRaw = proposal.business.ownerPhone || proposal.business.phone;
    if (phoneRaw) {
      const { sendText, normalizePhone } = await import("@/lib/leads/waha");
      const phone = normalizePhone(phoneRaw);
      const ws = await firstWorkspaceId();
      if (phone && ws) {
        await sendText({ workspaceId: ws, phoneNormalized: phone, text });
        whatsapp = true;
      }
    }
  } catch (e) {
    console.warn("[bubui subvenciones whatsapp]", (e as Error).message);
  }

  // Email.
  try {
    const { isEmailEnabled, sendEmail } = await import("@/lib/integrations/email");
    if (isEmailEnabled() && proposal.business.ownerEmail) {
      await sendEmail({
        to: proposal.business.ownerEmail,
        subject: `Subvenciones para ${proposal.business.name} — te las gestionamos`,
        html,
        text
      });
      email = true;
    }
  } catch (e) {
    console.warn("[bubui subvenciones email]", (e as Error).message);
  }

  await prisma.bubuiSubvencionProposal.update({
    where: { id: proposalId },
    data: { status: "sent", reviewedAt: new Date(), sentAt: new Date(), sentWhatsapp: whatsapp, sentEmail: email }
  });

  return { ok: true, whatsapp, email };
}

/** Descarta una propuesta (no se envía al comercio). */
export async function rejectProposal(proposalId: string): Promise<{ ok: boolean }> {
  await prisma.bubuiSubvencionProposal.updateMany({
    where: { id: proposalId, status: "pending" },
    data: { status: "rejected", reviewedAt: new Date() }
  });
  return { ok: true };
}

/** El comercio valida (un clic): quiere que la agencia se lo gestione. */
export async function acceptProposalByToken(
  token: string
): Promise<{ ok: boolean; businessName?: string; alreadyAccepted?: boolean }> {
  const proposal = await prisma.bubuiSubvencionProposal.findUnique({
    where: { token },
    include: { business: { select: { id: true, name: true } } }
  });
  if (!proposal) return { ok: false };
  if (proposal.status === "accepted") return { ok: true, businessName: proposal.business.name, alreadyAccepted: true };

  await prisma.bubuiSubvencionProposal.update({
    where: { id: proposal.id },
    data: { status: "accepted", respondedAt: new Date() }
  });

  const matches = (proposal.matches as unknown as SubvProposalMatch[]) ?? [];
  const lista = matches.slice(0, 6).map((m) => `• ${m.titulo}`).join("\n");
  await notifyTeam({
    subject: `✅ ${proposal.business.name} quiere que le gestionéis sus subvenciones`,
    text: `El comercio "${proposal.business.name}" ha aceptado que la agencia le gestione las subvenciones.\n\n${lista}\n\nContáctale para arrancar la gestión.`
  }).catch(() => {});

  // Aviso in-app en el panel del comercio.
  await prisma.bubuiBusinessNotification.create({
    data: {
      businessId: proposal.business.id,
      type: "subvenciones",
      message: "Hemos recibido tu solicitud de gestión de subvenciones. Te contactaremos en breve."
    }
  }).catch(() => {});

  return { ok: true, businessName: proposal.business.name };
}
