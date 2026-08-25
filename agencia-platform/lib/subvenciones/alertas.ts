/**
 * Avisos de cierre de plazo de subvenciones: para las convocatorias que un
 * cliente tiene marcadas como "interesa"/"en_proceso" y cierran pronto, manda
 * un aviso al webhook de Make del workspace (que enruta a WhatsApp/email).
 * Idempotente: marca notifiedCloseAt para no repetir.
 */
import { prisma } from "@/lib/db/prisma";
import { AGENCY_ID, matchForAgency } from "@/lib/subvenciones/match";
import { sendText, normalizePhone } from "@/lib/leads/waha";
import { hasDeliveryChannel, updateSubvencionHealth } from "@/lib/subvenciones/operations";

const DIAS_AVISO = 7;
// Encaje mínimo (0-100) para avisar de una oportunidad nueva para la agencia.
const OPORT_MIN_FIT = 78;
// Tope de ids recordados para no repetir avisos (evita que settings crezca sin fin).
const OPORT_MEMORY = 500;

const eur = (n: number | null) =>
  n ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "";

/**
 * Envía un WhatsApp best-effort por WAHA (el mismo proveedor que ya usa el
 * sistema de leads, con el plan Plus). Nunca rompe el aviso principal por email.
 */
async function sendWhatsAppWaha(workspaceId: string, to: string, text: string, session?: string): Promise<void> {
  try {
    const phone = normalizePhone(to);
    if (!phone) return;
    await sendText({ workspaceId, phoneNormalized: phone, text, session: session || undefined });
  } catch {
    /* best-effort: si WAHA falla, el email ya salió */
  }
}

export async function runSubvencionAlertas(): Promise<{ enviados: number }> {
  const now = new Date();
  const limite = new Date(now.getTime() + DIAS_AVISO * 86_400_000);
  let enviados = 0;

  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  for (const ws of workspaces) {
    const svc: any = (ws.settings as any)?.subvenciones ?? {};
    const webhookUrl: string = (svc.webhookUrl ?? "").trim();
    const waTo: string = (svc.whatsappTo ?? "").trim();
    const waSession: string = (svc.whatsappSession ?? "").trim();
    if (!hasDeliveryChannel(webhookUrl, waTo)) continue;

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
        const payload = {
            tipo: "subvencion_cierra_pronto",
            cliente: e.clientId === AGENCY_ID ? "Negocio Vivo (agencia)" : (clientById.get(e.clientId) ?? e.clientId),
            convocatoria: c.titulo,
            organo: c.organo,
            importe: c.importeTotal,
            estado: e.estado,
            diasRestantes,
            fechaFin: c.fechaFin.toISOString().slice(0, 10),
            urlBases: c.urlBases
        };
        if (webhookUrl) {
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) throw new Error(`Webhook de cierre respondió ${response.status}`);
        }
        await prisma.subvencionEstado.update({ where: { id: e.id }, data: { notifiedCloseAt: now } });
        enviados++;
        if (waTo) {
          const quien = e.clientId === AGENCY_ID ? "Negocio Vivo (agencia)" : (clientById.get(e.clientId) ?? e.clientId);
          const txt = `⏰ *Cierra en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"}* · ${quien}\n\n` +
            `*${c.titulo}*\nÓrgano: ${c.organo ?? "-"}\nImporte: ${eur(c.importeTotal) || "-"}\nEstado: ${e.estado}\nCierra: ${c.fechaFin.toISOString().slice(0, 10)}` +
            (c.urlBases ? `\n\n${c.urlBases}` : "");
          await sendWhatsAppWaha(ws.id, waTo, txt, waSession);
        }
      } catch {
        /* el aviso es best-effort */
      }
    }
    await updateSubvencionHealth(ws.id, {
      lastNotificationAt: new Date().toISOString(), notifications: enviados, lastError: null
    }).catch(() => {});
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
    const waTo: string = (sv.whatsappTo ?? "").trim();
    const waSession: string = (sv.whatsappSession ?? "").trim();
    if (!hasDeliveryChannel(oportWebhookUrl, waTo)) continue;

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
        const payload = {
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
        };
        if (oportWebhookUrl) {
          const response = await fetch(oportWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) throw new Error(`Webhook TOP respondió ${response.status}`);
        }
        enviadasOk.push(m.id);
        enviados++;
        if (waTo) {
          const txt = `🎯 *Oportunidad ${m.fitScore}/100 para Negocio Vivo*\n\n` +
            `${esLicitacion ? "Licitación pública" : "Subvención"}\n*${m.titulo}*\n` +
            `Órgano: ${m.organo ?? "-"}\nImporte: ${eur(m.importeTotal) || "-"}\nEncaja: ${m.motivo}` +
            (m.urlBases ? `\n\n${m.urlBases}` : "");
          await sendWhatsAppWaha(ws.id, waTo, txt, waSession);
        }
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
    await updateSubvencionHealth(ws.id, {
      lastNotificationAt: now.toISOString(), notifications: enviados, matches: top.length, lastError: null
    }).catch(() => {});
  }
  return { enviados };
}

/** Resumen diario compacto. Se envía una sola vez por día y agrupa las mejores
 * oportunidades para evitar una lluvia de mensajes individuales. */
export async function runSubvencionDigest(): Promise<{ enviados: number }> {
  const date = new Date().toISOString().slice(0, 10);
  let enviados = 0;
  const workspaces = await prisma.workspace.findMany({ select: { id: true, settings: true } });
  for (const ws of workspaces) {
    const sv: any = (ws.settings as any)?.subvenciones ?? {};
    if (sv.digestEnabled === false || sv.lastDigestDate === date) continue;
    const webhook = String(sv.oportWebhookUrl ?? "").trim();
    const waTo = String(sv.whatsappTo ?? "").trim();
    if (!webhook && !waTo) continue;
    let matches;
    try { matches = (await matchForAgency(ws.id)).slice(0, 5); } catch { continue; }
    const trackedClosing = await prisma.subvencionEstado.count({
      where: { workspaceId: ws.id, estado: { in: ["interesa", "en_proceso"] }, convocatoriaId: { in: (await prisma.subvencionConvocatoria.findMany({ where: { abierta: true, fechaFin: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) } }, select: { id: true } })).map((c) => c.id) } }
    });
    const lines = matches.length ? matches.map((m, i) => `${i + 1}. ${m.fitScore}/100 · ${m.titulo}`).join("\n") : "Sin nuevas coincidencias claras.";
    const text = `📊 *Resumen diario de subvenciones*\n\n${lines}\n\n⏰ En seguimiento y próximas a cerrar: ${trackedClosing}`;
    try {
      if (webhook) {
        const response = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "subvenciones_resumen_diario", fecha: date, oportunidades: matches, cierresProximos: trackedClosing }), signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Webhook de resumen respondió ${response.status}`);
      }
      if (waTo) await sendWhatsAppWaha(ws.id, waTo, text, String(sv.whatsappSession ?? ""));
      const settings: any = ws.settings ?? {};
      settings.subvenciones = { ...(settings.subvenciones ?? {}), lastDigestDate: date };
      await prisma.workspace.update({ where: { id: ws.id }, data: { settings } });
      enviados++;
    } catch { /* reintento en la siguiente ejecución */ }
  }
  return { enviados };
}
