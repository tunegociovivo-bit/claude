import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp"),
  isDefault: z.boolean().default(false)
});

// Plantilla de captación de comercios para Bubui. Gancho de 3 beneficios +
// Benalmádena (cercanía = más conversión) + {{enlace_bubui}}, que al enviar
// provisiona la ficha y mete el enlace mágico de alta sin fricción (1 clic).
const BUBUI_CAPTACION_NAME = "Captación Bubui — Benalmádena";
const BUBUI_CAPTACION_BODY = `Hola {{nombre_negocio}} 👋

Soy de *Bubui*, la app de Benalmádena que ayuda a los negocios locales a crecer. Te damos de alta GRATIS y consigues:

🧲 Más clientes en Benalmádena
👀 Más visibilidad en tu zona
💶 Subvenciones para crecer (te las gestionamos nosotros)

Todo gratis y en 2 minutos. ¿Te activo tu ficha? 👇
{{enlace_bubui}}`;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // Siembra idempotente: si el workspace aún no tiene la plantilla de
  // captación de Bubui, la creamos para que esté lista para usar.
  const existing = await prisma.leadTemplate.findFirst({
    where: { workspaceId: api.workspaceId, name: BUBUI_CAPTACION_NAME },
    select: { id: true }
  });
  if (!existing) {
    await prisma.leadTemplate
      .create({
        data: {
          workspaceId: api.workspaceId,
          name: BUBUI_CAPTACION_NAME,
          channel: "whatsapp",
          body: BUBUI_CAPTACION_BODY
        }
      })
      .catch(() => {});
  }

  const items = await prisma.leadTemplate.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const created = await prisma.leadTemplate.create({
    data: { workspaceId: api.workspaceId, ...parsed.data }
  });
  return NextResponse.json(created, { status: 201 });
});
