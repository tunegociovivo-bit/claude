/**
 * POST /api/v1/admin/import-accesos-asana
 *
 * Importa los accesos de cada cliente desde la tarea "CLIENTES" de
 * Asana (gid 1201694137821107). Estructura esperada:
 *   CLIENTES
 *     ├─ NOMBRE CLIENTE
 *     │    ├─ TIPO ACCESO 1  (notes = credenciales)
 *     │    └─ TIPO ACCESO 2  (notes = credenciales)
 *     └─ OTRO CLIENTE
 *          └─ ...
 *
 * Por cada cliente:
 *   1. Lee sus sub-subtareas con name+notes (1 sola call cada cliente)
 *   2. Construye texto formateado: "TIPO\n notes\n\nTIPO 2\n notes\n..."
 *   3. Matchea con Client de BD (case-insensitive + fuzzy)
 *   4. Update Client.accesos
 *
 * Body:
 *   { rootTaskId?: string (default 1201694137821107),
 *     onConflict?: "skip" | "overwrite" | "append" }
 *
 * Devuelve { jobId } y procesa en background.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listSubtasks, listSubtasksWithNotes, mapLimited } from "@/lib/asana/api";

const schema = z.object({
  rootTaskId: z.string().default("1201694137821107"),
  onConflict: z.enum(["skip", "overwrite", "append"]).default("skip")
});

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Verificamos que el usuario tenga conexión Asana.
  const conn = await prisma.asanaConnection.findFirst({
    where: { userId: api.userId },
    orderBy: { createdAt: "desc" }
  });
  if (!conn) {
    throw new ApiError(
      400,
      "no_asana_connection",
      "No tienes Asana vinculado. Ve a /admin/asana y conecta tu cuenta."
    );
  }

  const job = await prisma.backgroundJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      kind: "admin.import_accesos_asana",
      status: "PENDING",
      progressPct: 0,
      progressMsg: "En cola…",
      request: parsed.data as any
    }
  });

  runAsync(job.id, api.workspaceId, conn.accessToken, parsed.data.rootTaskId, parsed.data.onConflict).catch(
    (e) => console.error("[import-accesos-asana] fallo crítico:", e)
  );

  return NextResponse.json({ jobId: job.id }, { status: 202 });
});

async function runAsync(
  jobId: string,
  workspaceId: string,
  token: string,
  rootTaskId: string,
  onConflict: "skip" | "overwrite" | "append"
) {
  const t0 = Date.now();
  const events: any[] = [];
  const pushEvent = async (level: "info" | "warn" | "error", message: string) => {
    events.push({ ts: Date.now() - t0, level, message });
    await prisma.backgroundJob
      .update({ where: { id: jobId }, data: { events: events as any } })
      .catch(() => {});
  };
  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressMsg: "Conectando con Asana…", progressPct: 5 }
    });
    await pushEvent("info", `Job iniciado, leyendo subtareas de Asana task ${rootTaskId}`);

    // 1) Lista de clientes (subtareas del root)
    const clientSubtasks = await listSubtasks(token, rootTaskId);
    await pushEvent("info", `${clientSubtasks.length} clientes encontrados en Asana`);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { progressMsg: `${clientSubtasks.length} clientes encontrados`, progressPct: 10 }
    });

    // 2) Por cada cliente, sub-subtareas con notes (concurrencia limitada).
    let fetched = 0;
    type ClientData = { asanaName: string; accesosText: string };
    const allData: ClientData[] = await mapLimited(clientSubtasks, 8, async (sub, _idx) => {
      const subSubs = await listSubtasksWithNotes(token, sub.gid).catch(() => []);
      fetched++;
      if (fetched % 10 === 0) {
        const pct = 10 + Math.floor((fetched / clientSubtasks.length) * 70);
        await prisma.backgroundJob
          .update({
            where: { id: jobId },
            data: { progressMsg: `Leyendo accesos: ${fetched}/${clientSubtasks.length}`, progressPct: pct }
          })
          .catch(() => {});
      }
      // Formato: cada acceso como bloque "NOMBRE_ACCESO\nnotes"
      const blocks: string[] = [];
      for (const ss of subSubs) {
        const name = ss.name?.trim();
        const notes = (ss.notes ?? "").trim();
        if (!name) continue;
        if (notes) {
          blocks.push(`${name}\n${notes}`);
        } else {
          blocks.push(name);
        }
      }
      return { asanaName: sub.name, accesosText: blocks.join("\n\n") };
    });
    await pushEvent("info", `Acceso(s) leídos para ${allData.length} clientes`);

    // 3) Cargar clientes de BD y matchear
    const dbClients = await prisma.client.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, accesos: true }
    });
    const dbIndex = dbClients.map((c) => ({
      id: c.id,
      name: c.name,
      norm: normalize(c.name),
      existing: c.accesos
    }));

    function matchClient(name: string) {
      const n = normalize(name);
      if (!n) return null;
      for (const c of dbIndex) if (c.norm === n) return { ...c, matchType: "exact" as const };
      for (const c of dbIndex) {
        if (n.includes(c.norm) || c.norm.includes(n)) return { ...c, matchType: "contains" as const };
      }
      return null;
    }

    // 4) Aplicar updates
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { progressMsg: "Aplicando a BD…", progressPct: 85 }
    });
    let updated = 0;
    let skipped = 0;
    const noMatch: string[] = [];
    const skippedReasons: string[] = [];

    for (const d of allData) {
      if (!d.accesosText.trim()) {
        skipped++;
        continue;
      }
      const m = matchClient(d.asanaName);
      if (!m) {
        noMatch.push(d.asanaName);
        skipped++;
        continue;
      }
      const hasExisting = (m.existing?.length ?? 0) > 0;
      if (hasExisting && onConflict === "skip") {
        skippedReasons.push(`${m.name}: ya tenía accesos`);
        skipped++;
        continue;
      }
      let newAccesos = d.accesosText;
      if (hasExisting && onConflict === "append") {
        newAccesos = `${m.existing}\n\n--- importado desde Asana ---\n${d.accesosText}`;
      }
      await prisma.client.update({
        where: { id: m.id },
        data: { accesos: newAccesos }
      });
      updated++;
    }

    if (noMatch.length > 0) {
      await pushEvent("warn", `Sin match en BD: ${noMatch.slice(0, 10).join(", ")}${noMatch.length > 10 ? "…" : ""}`);
    }

    const summary = `✓ ${updated} actualizados · ${skipped} saltados (${noMatch.length} sin match)`;
    await pushEvent("info", summary);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: summary,
        result: {
          totalAsana: allData.length,
          updated,
          skipped,
          noMatch: noMatch.slice(0, 50),
          skippedReasons: skippedReasons.slice(0, 50)
        } as any
      }
    });
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, 500);
    await pushEvent("error", message);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "asana_import_failed",
        errorMessage: message,
        progressMsg: `Error: ${message.slice(0, 100)}`
      }
    });
  }
}
