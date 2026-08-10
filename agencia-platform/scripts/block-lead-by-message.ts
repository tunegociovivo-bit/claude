/**
 * Bloqueo manual de un lead a partir del TEXTO de uno de sus mensajes.
 *
 * Uso (donde la base de datos sea accesible, p. ej. una one-off de Railway con
 * DATABASE_URL):
 *
 *   # 1) DRY-RUN (por defecto): localiza y EXIGE unicidad, NO muta nada.
 *   FRAGMENT="Oye es la segunda vez q me escribes…" npx tsx scripts/block-lead-by-message.ts
 *
 *   # 2) Ejecutar el bloqueo real (solo si el dry-run confirmó UNA coincidencia):
 *   FRAGMENT="…" CONFIRM=yes npx tsx scripts/block-lead-by-message.ts
 *
 * Seguridad:
 *  - Busca en LeadInboxMessage.body Y LeadMessage.renderedMessage (insensitive).
 *  - EXIGE una única conversación/lead en un único workspace antes de mutar.
 *  - Bloquea con la MISMA lógica transaccional/persistida que el botón
 *    "🚫 Bloquear para siempre" (blockLeadCompletely → LeadOptout + exclusión +
 *    cancelar cola + parar secuencias). Es idempotente.
 *  - NO envía ningún mensaje al contacto. No borra facturas ni conversaciones.
 *  - Enmascara el teléfono en la salida.
 */
import { prisma } from "../lib/db/prisma";
import { blockLeadCompletely } from "../lib/leads/optout";

function mask(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone.length <= 4 ? "***" : `***${phone.slice(-3)}`;
}
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function main() {
  const FRAGMENT = norm(process.env.FRAGMENT ?? process.argv.slice(2).filter((a) => a !== "--confirm").join(" ") ?? "");
  const CONFIRM = process.env.CONFIRM === "yes" || process.argv.includes("--confirm");
  if (FRAGMENT.length < 8) {
    console.error("Fragmento demasiado corto (mínimo 8 caracteres). Pásalo con FRAGMENT=\"…\".");
    process.exit(1);
  }

  console.log(`Buscando el fragmento (${FRAGMENT.length} chars) en mensajes entrantes y salientes…`);
  const [inbox, outbound] = await Promise.all([
    prisma.leadInboxMessage.findMany({
      where: { body: { contains: FRAGMENT, mode: "insensitive" } },
      select: { workspaceId: true, phoneNormalized: true, fromPhone: true, leadId: true, direction: true, receivedAt: true }
    }),
    prisma.leadMessage.findMany({
      where: { renderedMessage: { contains: FRAGMENT, mode: "insensitive" } },
      select: { workspaceId: true, phoneNormalized: true, leadId: true, createdAt: true }
    })
  ]);

  // Candidatos por (workspaceId + teléfono de conversación). El leadId se agrega aparte.
  const byKey = new Map<string, { workspaceId: string; phone: string; leadIds: Set<string>; hits: number; sources: Set<string> }>();
  const addHit = (workspaceId: string, phone: string | null, leadId: string | null, source: string) => {
    const p = phone ?? "";
    const key = `${workspaceId}::${p}`;
    let c = byKey.get(key);
    if (!c) { c = { workspaceId, phone: p, leadIds: new Set(), hits: 0, sources: new Set() }; byKey.set(key, c); }
    c.hits++; c.sources.add(source);
    if (leadId) c.leadIds.add(leadId);
  };
  for (const m of inbox) addHit(m.workspaceId, m.phoneNormalized ?? m.fromPhone, m.leadId, m.direction === "in" ? "inbound" : "inbox-out");
  for (const m of outbound) addHit(m.workspaceId, m.phoneNormalized, m.leadId, "outbound");

  const workspaces = new Set([...byKey.values()].map((c) => c.workspaceId));
  console.log(`Coincidencias: ${inbox.length} entrantes + ${outbound.length} salientes → ${byKey.size} conversación(es) en ${workspaces.size} workspace(s).`);

  if (byKey.size === 0) {
    console.log("❌ Ningún mensaje contiene ese fragmento. Nada que bloquear (revisa el texto exacto / que el webhook lo haya ingerido).");
    return;
  }
  if (byKey.size > 1 || workspaces.size > 1) {
    console.log("⚠️ Coincidencia NO única — no se muta nada. Candidatas:");
    for (const c of byKey.values()) {
      const ws = await prisma.workspace.findUnique({ where: { id: c.workspaceId }, select: { name: true } }).catch(() => null);
      console.log(`  · ws=${c.workspaceId} (${ws?.name ?? "?"}) · tel=${mask(c.phone)} · leadIds=[${[...c.leadIds].join(",") || "—"}] · hits=${c.hits} · ${[...c.sources].join("+")}`);
    }
    console.log("Afina el fragmento hasta que quede UNA sola conversación.");
    return;
  }

  const cand = [...byKey.values()][0];
  const leadId = [...cand.leadIds][0] ?? null;
  const ws = await prisma.workspace.findUnique({ where: { id: cand.workspaceId }, select: { name: true } }).catch(() => null);
  console.log(`✅ Coincidencia ÚNICA: workspace=${cand.workspaceId} (${ws?.name ?? "?"}) · tel=${mask(cand.phone)} · leadId=${leadId ?? "—"} · fuentes=${[...cand.sources].join("+")}`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN. No se ha bloqueado nada. Para ejecutar el bloqueo real, repite con CONFIRM=yes.");
    return;
  }

  console.log("\nBloqueando PARA SIEMPRE (misma lógica que el botón; no se envía ningún mensaje)…");
  const res = await blockLeadCompletely({
    workspaceId: cand.workspaceId,
    phone: cand.phone || null,
    leadId,
    reason: "Bloqueo manual autorizado: el contacto pidió cese de comunicaciones (amenaza de denuncia).",
    source: "manual"
  });
  console.log(`  · lead=${res.leadId ?? "—"} (${res.businessName ?? "—"})`);
  console.log(`  · opt-out teléfonos: ${res.optoutPhones.length}`);
  console.log(`  · mensajes en cola cancelados: ${res.canceledMessages}`);
  console.log(`  · secuencias detenidas: ${res.stoppedSequences} · exec-outreach: ${res.stoppedExec}`);
  console.log(`  · negocio marcado como EXCLUIDO: ${res.excludedLead ? "sí" : "no"}`);

  // Verificación de lectura de TODAS las señales persistidas relevantes.
  console.log("\nVerificación (solo lectura):");
  const optouts = await prisma.leadOptout.findMany({ where: { workspaceId: cand.workspaceId, OR: [{ phone: cand.phone }, ...(leadId ? [{ leadId }] : [])] }, select: { phone: true, source: true } });
  console.log(`  · LeadOptout: ${optouts.length} fila(s) [${optouts.map((o) => mask(o.phone)).join(", ")}]`);
  if (res.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: res.leadId }, select: { contactStatus: true } });
    console.log(`  · Lead.contactStatus = ${lead?.contactStatus ?? "?"} (debe ser "excluded")`);
    const activeSeq = await prisma.leadSequenceAssignment.count({ where: { leadId: res.leadId, status: "active" } });
    const queued = await prisma.leadMessage.count({ where: { leadId: res.leadId, status: { in: ["queued", "sending"] } } });
    console.log(`  · Secuencias activas restantes: ${activeSeq} (debe ser 0)`);
    console.log(`  · Mensajes en cola restantes: ${queued} (debe ser 0)`);
  }
  console.log("\nHecho. El lead no recibirá más mensajes ni entrará en futuras búsquedas/secuencias.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
