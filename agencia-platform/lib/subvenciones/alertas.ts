/**
 * Avisos de cierre de plazo de subvenciones: para las convocatorias que un
 * cliente tiene marcadas como "interesa"/"en_proceso" y cierran pronto, manda
 * un aviso al webhook de Make del workspace (que enruta a WhatsApp/email).
 * Idempotente: marca notifiedCloseAt para no repetir.
 */
import { prisma } from "@/lib/db/prisma";
import { AGENCY_ID, matchForAgency } from "@/lib/subvenciones/match";

const DIAS_AVISO = 7;
// Encaje mínimo (0-100) para avisar de una oportunidad nueva para la agencia.
const OPORT_MIN_FIT = 78;
// Tope de ids recordados para no repetir avisos (evita que settings crezca sin fin).
const OPORT_MEMORY = 500;

const eur = (n: number | null) =>
  n ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "";

export async function runSubvencionAlertas(): Promise<{ enviados: number }> {
  const now = new Date();
  const limite = new Date(now.getTime() + DIAS_AVISO * 86_400_000);
  let enviados = 0;

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  for (const ws of workspaces) {
    const webhookUrl = (ws.settings as any)?.subvenciones?.webhookUrl?.trim();
    if (!webhookUrl) continue;

    const estados = await prisma.subvencionEstado.findMany({
      where: {
        workspaceId: ws.id,
        estado: { in: ["interesa", "en_proceso"] },
        OR: [{ notifiedCloseAt: null }, { notifiedCloseAt: { lt: new Date(now.getTime() - 3 * 86_400_000) } }]
      }
    });
    if (estados.length === 0) continue;

    const convIds = [...new Set(estados.map((e) => e.convocatoriaId))];
    const clientIds = [...new Set(estados.map((e) => e.clientId))];
    const [convs, clients] = await Promise.all([
      prisma.subvencionConvocatoria.findMany({ where: { id: { in: convIds } } }),
      prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
    ]);
    const convById = new Map(convs.map((c) => [c.id, c]));
    const clientById = new Map(clients.map((c) => [c.id, c.name]));

    for (const e of estados) {
      const c = convById.get(e.convocatoriaId);
      if (!c?.fechaFin) continue;
      if (c.fechaFin.getTime() < now.getTime() || c.fechaFin.getTime() > limite.getTime()) continue; // solo si cierra dentro de la ventana
      const diasRestantes = Math.ceil((c.fechaFin.getTime() - now.getTime()) / 86_400_000);
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "subvencion_cierra_pronto",
            cliente: e.clientId === AGENCY_ID ? "Negocio Vivo (agencia)" : (clientById.get(e.clientId) ?? e.clientId),
            convocatoria: c.titulo,
            organo: c.organo,
            importe: c.importeTotal,
            estado: e.estado,
            diasRestantes,
            fechaFin: c.fechaFin.toISOString().slice(0, 10),
            urlBases: c.urlBases
          }),
          signal: AbortSignal.timeout(12000)
        });
        await prisma.subvencionEstado.update({ where: { id: e.id }, data: { notifiedCloseAt: now } });
        enviados++;
      } catch {
        /* el aviso es best-effort */
      }
    }
  }
  return { enviados };
}

/**
 * Aviso de OPORTUNIDAD TOP para la agencia (Negocio Vivo): cruza el catálogo con
 * el perfil de la agencia y avisa de las subvenciones/licitaciones NUEVAS con
 * alto encaje (>= OPORT_MIN_FIT) que aún no se habían avisado. Idempotente vía
 * settings.subvenciones.notifiedAgencyMatches. Usa el webhook oportWebhookUrl.
 */
export async function runAgencyOpportunityAlerts(): Promise<{ enviados: number }> {
  const now = new Date();
  let enviados = 0;

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  for (const ws of workspaces) {
    const sv = (ws.settings as any)?.subvenciones ?? {};
    const oportWebhookUrl: string = (sv.oportWebhookUrl ?? "").trim();
    if (!oportWebhookUrl) continue;

    let matches;
    try {
      matches = await matchForAgency(ws.id, { force: true });
    } catch {
      continue; // IA no configurada u otro fallo: best-effort
    }
    const top = matches.filter((m) => m.fitScore >= OPORT_MIN_FIT);
    if (top.length === 0) continue;

    const yaAvisadas: string[] = Array.isArray(sv.notifiedAgencyMatches) ? sv.notifiedAgencyMatches : [];
    const avisadasSet = new Set(yaAvisadas);
    const nuevas = top.filter((m) => !avisadasSet.has(m.id));
    if (nuevas.length === 0) continue;

    // Fuente de cada convocatoria para etiquetar subvención vs licitación.
    const convs = await prisma.subvencionConvocatoria.findMany({
      where: { id: { in: nuevas.map((m) => m.id) } },
      select: { id: true, fuente: true }
    });
    const fuenteById = new Map(convs.map((c) => [c.id, c.fuente]));

    const enviadasOk: string[] = [];
    for (const m of nuevas) {
      const fuente = (fuenteById.get(m.id) ?? "").toLowerCase();
      const esLicitacion = fuente.includes("placsp") || fuente.includes("licit") || fuente.includes("contrat");
      try {
        await fetch(oportWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "oportunidad_top",
            tipoOportunidad: esLicitacion ? "Licitación pública" : "Subvención",
            objetivo: "Negocio Vivo (agencia)",
            convocatoria: m.titulo,
            organo: m.organo ?? "",
            importe: eur(m.importeTotal),
            fechaFin: m.fechaFin ? m.fechaFin.toISOString().slice(0, 10) : "",
            fitScore: m.fitScore,
            motivo: m.motivo,
            requisitos: m.requisitos,
            urlBases: m.urlBases ?? ""
          }),
          signal: AbortSignal.timeout(12000)
        });
        enviadasOk.push(m.id);
        enviados++;
      } catch {
        /* best-effort: si falla, se reintenta en la próxima pasada */
      }
    }

    if (enviadasOk.length > 0) {
      const memoria = [...enviadasOk, ...yaAvisadas].slice(0, OPORT_MEMORY);
      const settings: any = ws.settings ?? {};
      settings.subvenciones = settings.subvenciones ?? {};
      settings.subvenciones.notifiedAgencyMatches = memoria;
      await prisma.workspace.update({ where: { id: ws.id }, data: { settings } }).catch(() => {});
    }
  }
  return { enviados };
}
