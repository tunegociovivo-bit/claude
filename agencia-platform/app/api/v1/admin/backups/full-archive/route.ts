/**
 * Descarga "copia completa": un ZIP en streaming con
 *   - database.json  → volcado de TODAS las tablas del workspace.
 *   - files/<s3Key>  → cada adjunto binario, descargado de R2.
 *
 * El JSON de /admin/backups solo trae la BD (texto); los binarios de los
 * adjuntos viven en R2 y no caben en un JSON. Esta ruta los empaqueta juntos
 * para tener "absolutamente todo" en un solo archivo descargable.
 *
 * Streaming + secuencial: cada objeto de R2 se abre y se vuelca uno a uno
 * (esperando a que la entrada anterior se escriba), así la memoria queda
 * acotada a ~un fichero aunque el total sean muchos GB. Si un adjunto falla
 * (borrado en R2, etc.) se anota en _ADJUNTOS_NO_INCLUIDOS.txt y se sigue.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateWorkspaceDump } from "@/lib/backup/dump";
import { isStorageEnabled, downloadBuffer } from "@/lib/storage/r2";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  // 1) Volcado de la BD (todas las tablas).
  const dump = await generateWorkspaceDump(api.workspaceId);
  const json = JSON.stringify(dump, null, 2);

  // 2) Adjuntos del workspace (metadata; el binario se baja de R2).
  const files = await prisma.file.findMany({
    where: { workspaceId: api.workspaceId },
    select: { id: true, s3Key: true, name: true }
  });

  const archive = archiver("zip", { zlib: { level: 1 } });
  const pass = new PassThrough();
  archive.on("warning", (w: any) => console.warn("[full-archive] warning:", w?.message ?? w));
  archive.on("error", (e: any) => {
    console.error("[full-archive] error:", e?.message ?? e);
    pass.destroy(e);
  });
  archive.pipe(pass);

  // Construcción en segundo plano mientras el ZIP se transmite al cliente.
  (async () => {
    try {
      await appendAndDrain(archive, Buffer.from(json, "utf8"), { name: "database.json" });

      const noIncluidos: string[] = [];
      if (!isStorageEnabled()) {
        noIncluidos.push("R2 no está configurado: no se incluyó ningún adjunto.");
      } else {
        const seen = new Set<string>();
        for (const f of files) {
          if (!f.s3Key || seen.has(f.s3Key)) continue;
          seen.add(f.s3Key);
          try {
            const buf = await downloadBuffer(f.s3Key);
            await appendAndDrain(archive, buf, { name: `files/${f.s3Key}` });
          } catch (e: any) {
            noIncluidos.push(`${f.s3Key} (${f.name}): ${String(e?.message ?? e).slice(0, 140)}`);
          }
        }
      }

      if (noIncluidos.length > 0) {
        await appendAndDrain(
          archive,
          Buffer.from(noIncluidos.join("\n"), "utf8"),
          { name: "_ADJUNTOS_NO_INCLUIDOS.txt" }
        );
      }

      await archive.finalize();
    } catch (e) {
      archive.destroy(e as Error);
    }
  })();

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  return new NextResponse(Readable.toWeb(pass) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="hub-backup-completo-${stamp}.zip"`,
      "Cache-Control": "no-store"
    }
  });
});

/**
 * Añade una entrada al ZIP y resuelve cuando se ha volcado (evento "entry").
 * Al serializar los append, solo hay ~un fichero en memoria a la vez.
 */
function appendAndDrain(
  archive: archiver.Archiver,
  source: Buffer,
  data: archiver.EntryData
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = () => {
      cleanup();
      resolve();
    };
    const onError = (e: unknown) => {
      cleanup();
      reject(e);
    };
    function cleanup() {
      archive.removeListener("entry", onEntry);
      archive.removeListener("error", onError);
    }
    archive.on("entry", onEntry);
    archive.on("error", onError);
    archive.append(source, data);
  });
}
