/**
 * GET /api/v1/admin/meta-invoices/zip?month=YYYY-MM
 *
 * Devuelve un ZIP con TODOS los PDFs de facturas de Meta archivados ese mes
 * (gastos de categoría PUBLICIDAD, proveedor Meta, con su PDF). Solo admins.
 */
import { NextResponse } from "next/server";
import archiver from "archiver";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { downloadBuffer, isStorageEnabled } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  if (!isStorageEnabled()) throw new ApiError(503, "storage_disabled", "Storage no configurado");

  const monthParam = new URL(req.url).searchParams.get("month") ?? "";
  const m = monthParam.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new ApiError(400, "bad_month", "Formato de mes inválido (usa YYYY-MM)");
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);

  // Gastos de Meta de ese mes con PDF (fileId marcado en notes).
  const expenses = await prisma.expense.findMany({
    where: {
      workspaceId: api.workspaceId,
      deletedAt: null,
      category: "PUBLICIDAD",
      supplier: { contains: "Meta", mode: "insensitive" },
      date: { gte: start, lt: end },
      notes: { contains: "[metafile:" }
    },
    select: { id: true, notes: true, concept: true }
  });

  const fileIds: string[] = [];
  for (const e of expenses) {
    const fm = (e.notes ?? "").match(/\[metafile:([^\]]+)\]/);
    if (fm) fileIds.push(fm[1]);
  }
  if (fileIds.length === 0) {
    throw new ApiError(404, "empty", `No hay facturas de Meta archivadas en ${monthParam}.`);
  }

  const files = await prisma.file.findMany({
    where: { id: { in: fileIds }, workspaceId: api.workspaceId },
    select: { id: true, name: true, s3Key: true }
  });

  // Construimos el ZIP en memoria (las facturas de un mes son pocas y ligeras).
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  const used = new Set<string>();
  for (const f of files) {
    try {
      const buf = await downloadBuffer(f.s3Key);
      let name = f.name || `${f.id}.pdf`;
      if (!/\.pdf$/i.test(name)) name += ".pdf";
      // Evita nombres duplicados dentro del zip.
      let unique = name;
      let n = 2;
      while (used.has(unique)) {
        unique = name.replace(/\.pdf$/i, "") + `_${n}.pdf`;
        n++;
      }
      used.add(unique);
      archive.append(buf, { name: unique });
    } catch {
      // si un PDF no se puede bajar, lo saltamos
    }
  }
  archive.finalize();
  await done;

  const zip = Buffer.concat(chunks);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="facturas-meta-${monthParam}.zip"`,
      "Cache-Control": "no-store"
    }
  });
});
