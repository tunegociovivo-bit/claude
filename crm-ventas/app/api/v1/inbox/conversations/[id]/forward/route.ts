import { NextRequest } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { ForwardError, forwardMessages, MAX_FORWARD_ITEMS } from "@/lib/inbox/forward";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  messageIds: z.array(z.string().min(1).max(40)).min(1).max(MAX_FORWARD_ITEMS),
  targetId: z.string().min(1).max(60),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

// POST → reenvía los mensajes seleccionados a un destino de «ENVIAR A»
// desde el número por el que se habla con este cliente.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: `Selecciona entre 1 y ${MAX_FORWARD_ITEMS} mensajes` }, { status: 400 });
    }
    const result = await forwardMessages({
      workspaceId: user.workspaceId,
      conversationId: params.id,
      messageIds: parsed.data.messageIds,
      targetId: parsed.data.targetId,
      userId: user.userId,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    return Response.json({ ok: result.results.every((r) => r.ok), ...result });
  } catch (error) {
    if (error instanceof ForwardError) return Response.json({ error: error.message }, { status: error.status });
    return inboxError(error);
  }
}
