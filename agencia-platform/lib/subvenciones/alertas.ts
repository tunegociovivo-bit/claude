/**
 * Avisos de cierre de plazo de subvenciones: para las convocatorias que un
 * cliente tiene marcadas como "interesa"/"en_proceso" y cierran pronto, manda
 * un aviso al webhook de Make del workspace (que enruta a WhatsApp/email).
 * Idempotente: marca notifiedCloseAt para no repetir.
 */
import { prisma } from "@/lib/db/prisma";

const DIAS_AVISO = 7;

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
            cliente: clientById.get(e.clientId) ?? e.clientId,
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
