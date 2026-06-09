/**
 * POST /api/v1/leads/queue/reschedule
 *
 * Re-pagina (reprograma) la cola de envío distribuyendo los mensajes en cola
 * a partir de `from` (por defecto, ahora), respetando ventana horaria, fines
 * de semana, tope diario y el espaciado anti-baneo.
 *
 * Body: { ids?: string[], from?: string (ISO) }
 *  - ids: si se pasan, solo re-pagina esos; si no, TODOS los queued.
 *  - from: fecha de arranque; si se omite o es pasada, se usa "ahora".
 *
 * Caso de uso: una búsqueda nueva queda encadenada tras el backlog y no
 * empieza a enviar hasta dentro de varios días. Esto la adelanta.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { repaceQueue } from "@/lib/leads/send-queue";

const schema = z.object({
  ids: z.array(z.string().min(1)).max(2000).optional(),
  from: z.string().min(1).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let from: Date | undefined;
  if (parsed.data.from) {
    const d = new Date(parsed.data.from);
    if (isNaN(d.getTime())) throw new ApiError(400, "bad_date", "Fecha 'from' inválida");
    from = d;
  }

  try {
    const out = await repaceQueue({
      workspaceId: api.workspaceId,
      ids: parsed.data.ids,
      from
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    throw new ApiError(500, "reschedule_error", e?.message ?? "No se pudo reprogramar la cola");
  }
});
