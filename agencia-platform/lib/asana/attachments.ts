/**
 * Descarga adjuntos de tareas Asana y los re-sube al storage del Hub
 * como File ligado a la tarea local. Idempotente vía File.asanaId.
 *
 * No tocamos nada en Asana — leemos la URL temporal de descarga, la
 * fetcheamos como cliente, y la subimos a R2/S3.
 *
 * Limitaciones:
 *  - Sólo procesa adjuntos resource_subtype="asana" (los hosted en
 *    Asana propio). Para "gdrive", "dropbox", "external" no tenemos
 *    download_url; persistimos un placeholder con el view_url como
 *    referencia. Esos se descargan haciendo click manual en la UI.
 *  - download_url caduca rápido — pedimos los detalles uno a uno
 *    justo antes de la descarga.
 */

import { prisma } from "@/lib/db/prisma";
import { isStorageEnabled, uploadBuffer, buildS3Key } from "@/lib/storage/r2";
import { AsanaClient, type AsanaAttachment } from "./client";

export type AttachmentResult = {
  imported: number; // archivos nuevos creados (subidos a R2)
  externalLinked: number; // adjuntos externos referenciados con view_url (sin subir)
  skipped: number; // ya existían (File.asanaId match)
  failed: number;
  errors: string[];
};

export async function importAttachmentsForTask(opts: {
  client: AsanaClient;
  workspaceId: string;
  taskLocalId: string;
  taskAsanaGid: string;
}): Promise<AttachmentResult> {
  const result: AttachmentResult = { imported: 0, externalLinked: 0, skipped: 0, failed: 0, errors: [] };

  const storageOk = isStorageEnabled();
  for await (const a of opts.client.taskAttachments(opts.taskAsanaGid)) {
    try {
      // Idempotencia. PERO: si el File existe con un targetId/
      // workspaceId obsoleto (porque la tarea local fue re-creada,
      // re-importada, soft-deleted, etc.), lo RE-ENLAZAMOS al task
      // actual en lugar de saltarlo. Sin esto los adjuntos quedaban
      // huérfanos y nunca aparecían en la AttachmentList del modal
      // aunque el botón dijera "skipped" — mismo bug que ya tuvimos
      // con los comentarios.
      const existing = await prisma.file.findUnique({ where: { asanaId: a.gid } });
      if (existing) {
        const needsRelink =
          existing.targetId !== opts.taskLocalId ||
          existing.targetType !== "TASK" ||
          existing.workspaceId !== opts.workspaceId;
        if (needsRelink) {
          await prisma.file.update({
            where: { id: existing.id },
            data: {
              targetId: opts.taskLocalId,
              targetType: "TASK",
              workspaceId: opts.workspaceId
            }
          });
          result.errors.push(
            `Adjunto "${a.name}" re-enlazado: ${existing.targetId} → ${opts.taskLocalId}`
          );
        }
        result.skipped++;
        continue;
      }

      // Para adjuntos hospedados en otros sitios (gdrive, dropbox,
      // external), no hay forma de descargar el binario. Guardamos
      // un File "placeholder" con s3Key vacío y view_url en el
      // nombre — la UI deja claro que es un link externo.
      const isAsanaHosted = a.resource_subtype === "asana" || !a.resource_subtype;
      if (!storageOk || !isAsanaHosted) {
        try {
          await prisma.file.create({
            data: {
              workspaceId: opts.workspaceId,
              name: a.name || `${a.host ?? "external"}-${a.gid}`,
              mimeType: "application/octet-stream",
              sizeBytes: a.size ?? 0,
              // Sin binario: s3Key vacío. Como la columna no acepta null,
              // metemos un marcador identificable.
              s3Key: `__external__:${a.view_url ?? a.permanent_url ?? ""}`,
              targetType: "TASK",
              targetId: opts.taskLocalId,
              asanaId: a.gid
            }
          });
          result.externalLinked++;
        } catch (e: any) {
          if (e?.code === "P2002") {
            // Carrera: el findUnique de arriba devolvió null y entre tanto
            // otro proceso/batch lo creó. Re-enlazar al task actual igual
            // que en la rama "exists" del findUnique.
            await prisma.file.updateMany({
              where: { asanaId: a.gid },
              data: {
                targetId: opts.taskLocalId,
                targetType: "TASK",
                workspaceId: opts.workspaceId
              }
            });
            result.skipped++;
          } else {
            throw e;
          }
        }
        continue;
      }

      // Pedir detalles con download_url fresco.
      const details = await opts.client.attachmentDetails(a.gid);
      const url = details.data.download_url;
      if (!url) {
        result.failed++;
        result.errors.push(`Sin download_url para ${a.name} (${a.gid})`);
        continue;
      }

      // Fetch del binario.
      const r = await fetch(url);
      if (!r.ok) {
        result.failed++;
        result.errors.push(`${a.name}: HTTP ${r.status}`);
        continue;
      }
      const contentType = r.headers.get("content-type") ?? "application/octet-stream";
      const buf = Buffer.from(await r.arrayBuffer());

      // Subir a R2.
      const s3Key = buildS3Key({
        workspaceId: opts.workspaceId,
        targetType: "TASK",
        targetId: opts.taskLocalId,
        filename: a.name || `asana-${a.gid}`
      });
      await uploadBuffer({ s3Key, body: buf, contentType });

      try {
        await prisma.file.create({
          data: {
            workspaceId: opts.workspaceId,
            name: a.name || `asana-${a.gid}`,
            mimeType: contentType,
            sizeBytes: buf.length,
            s3Key,
            targetType: "TASK",
            targetId: opts.taskLocalId,
            asanaId: a.gid
          }
        });
        result.imported++;
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Carrera: el binario ya está subido pero el row no se pudo
          // crear porque otro batch lo metió antes. Re-enlazamos al
          // task actual (s3Key se sobreescribe con el nuevo bucket
          // path, que es válido — el viejo queda huérfano en R2 pero
          // poco coste). Contamos como skipped.
          await prisma.file.updateMany({
            where: { asanaId: a.gid },
            data: {
              targetId: opts.taskLocalId,
              targetType: "TASK",
              workspaceId: opts.workspaceId,
              s3Key,
              mimeType: contentType,
              sizeBytes: buf.length
            }
          });
          result.skipped++;
        } else {
          throw e;
        }
      }
    } catch (e: any) {
      result.failed++;
      result.errors.push(String(e?.message ?? e).slice(0, 200));
    }
  }

  return result;
}
