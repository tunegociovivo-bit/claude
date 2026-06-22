import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // Siembra idempotente de la secuencia automática de captación de Bubui:
  // mensaje principal (día 0) → seguimiento (día 3) solo si NO respondió.
  const SEQ_NAME = "Captación Bubui (automática)";
  const seqExists = await prisma.leadSequence.findFirst({
    where: { workspaceId: api.workspaceId, name: SEQ_NAME },
    select: { id: true }
  });
  if (!seqExists) {
    const principal = `Hola {{nombre_negocio}} 👋

Soy de *Bubui*, la app de Benalmádena que ayuda a los negocios locales a crecer. Te damos de alta GRATIS y consigues:

🧲 Más clientes en Benalmádena
👀 Más visibilidad en tu zona
💶 Subvenciones para crecer (te las gestionamos nosotros)

Todo gratis y en 2 minutos. ¿Te activo tu ficha? 👇
{{enlace_bubui}}
{{colaboracion_ayto}}`;
    const seguimiento = `Hola de nuevo {{nombre_negocio}} 👋

¿Pudiste ver lo de *Bubui*? Es la app de Benalmádena que te trae clientes, te da visibilidad y te busca subvenciones — todo GRATIS.

Sigue disponible tu alta sin coste 👇
{{enlace_bubui}}

Si prefieres que te lo cuente en 2 minutos por teléfono, dímelo y te llamo. 🙂
{{colaboracion_ayto}}`;
    await prisma.leadSequence
      .create({
        data: {
          workspaceId: api.workspaceId,
          name: SEQ_NAME,
          description: "Capta comercios para Bubui: mensaje con gancho + seguimiento a los 3 días si no responde.",
          active: true,
          isDefault: false,
          steps: {
            create: [
              { order: 0, delayDays: 0, delayHours: 0, templateBody: principal, kind: "text", channel: "whatsapp", stopIfResponded: true },
              { order: 1, delayDays: 3, delayHours: 72, templateBody: seguimiento, kind: "text", channel: "whatsapp", stopIfResponded: true }
            ]
          }
        }
      })
      .catch(() => {});
  }

  const items = await prisma.leadSequence.findMany({
    where: { workspaceId: api.workspaceId },
    include: { steps: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        order: z.number().int().min(0),
        delayDays: z.number().int().min(0).default(0),
        delayHours: z.number().int().min(0).optional(),
        // En pasos "ranking" (imagen) el cuerpo es solo el pie de foto y puede ir vacío.
        templateBody: z.string().default(""),
        kind: z.enum(["text", "ranking"]).default("text"),
        channel: z.string().default("whatsapp"),
        stopIfResponded: z.boolean().default(true)
      })
    )
    .min(1)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const seq = await prisma.leadSequence.create({
    data: {
      workspaceId: api.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
      isDefault: parsed.data.isDefault,
      steps: {
        create: parsed.data.steps.map((s) => ({
          order: s.order,
          delayDays: s.delayDays,
          delayHours: s.delayHours ?? s.delayDays * 24,
          templateBody: s.templateBody,
          kind: s.kind,
          channel: s.channel,
          stopIfResponded: s.stopIfResponded
        }))
      }
    },
    include: { steps: true }
  });
  return NextResponse.json(seq, { status: 201 });
});
