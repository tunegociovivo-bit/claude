/**
 * POST /api/v1/admin/db-fix-comment-fks
 *
 * Hotfix: elimina los dos FK constraints conflictivos sobre
 * Comment.targetId (Comment_task_fk y Comment_doc_fk). Estos FK
 * eran polimórficos sobre la misma columna y Postgres exigía que
 * el id existiera en AMBAS tablas a la vez — imposible. Resultado:
 * cualquier creación de Comment tiraba "Foreign key constraint
 * violated: Comment_doc_fk (index)".
 *
 * El schema.prisma de b5268f7 ya quitó las relations, pero hasta
 * que no se ejecuta `prisma db push` (o `prisma migrate deploy`)
 * en la BD productiva, los constraints siguen vivos. Este endpoint
 * los borra a mano con SQL raw para que la importación de Asana
 * funcione sin necesidad de acceso SSH a la BD.
 *
 * Idempotente: si los constraints ya no existen, Postgres devuelve
 * un warning y seguimos. Solo admin.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");

  const dropped: string[] = [];
  const errors: string[] = [];

  // IF EXISTS evita romper si ya estaban borrados por un db push previo.
  for (const cn of ["Comment_task_fk", "Comment_doc_fk"]) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Comment" DROP CONSTRAINT IF EXISTS "${cn}"`
      );
      dropped.push(cn);
    } catch (e: any) {
      errors.push(`${cn}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  // Verificación post: que ya no quedan FK contra Document/Task sobre
  // targetId. Si quedan, devolvemos la lista para diagnóstico.
  const remaining = (await prisma.$queryRawUnsafe(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"Comment"'::regclass AND contype = 'f'
      AND conname IN ('Comment_task_fk', 'Comment_doc_fk')
  `)) as { conname: string }[];

  auditFromReq(req, api, {
    action: "db.fix_comment_fks",
    meta: { dropped, errors, remaining: remaining.map((r) => r.conname) }
  });

  return NextResponse.json({ ok: errors.length === 0, dropped, errors, remaining });
});
