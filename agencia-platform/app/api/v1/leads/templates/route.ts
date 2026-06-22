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

// Plantillas de captación de comercios para Bubui, sembradas (idempotente)
// por workspace para que estén listas para usar. Gancho de 3 beneficios +
// Benalmádena (cercanía = más conversión).
//  - "Captación": mensaje principal con {{enlace_bubui}} (alta de 1 clic).
//  - "Demo": enseña cómo se vería SU negocio en Bubui antes de darse de alta.
//  - "Seguimiento": recordatorio para los que no responden al primero.
const BUBUI_CAPTACION_NAME = "Captación Bubui — Benalmádena";
const BUBUI_DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  {
    name: BUBUI_CAPTACION_NAME,
    body: `Hola {{nombre_negocio}} 👋

Soy de *Bubui*, la app de Benalmádena que ayuda a los negocios locales a crecer. Te damos de alta GRATIS y consigues:

🧲 Más clientes en Benalmádena
👀 Más visibilidad en tu zona
💶 Subvenciones para crecer (te las gestionamos nosotros)

Todo gratis y en 2 minutos. ¿Te activo tu ficha? 👇
{{enlace_bubui}}`
  },
  {
    name: "Captación Bubui — Demo",
    body: `Hola {{nombre_negocio}} 👋

Te he preparado una *demo* de cómo se vería tu negocio en *Bubui*, la app de Benalmádena para descubrir y premiar al comercio local 👇
{{demo_bubui}}

Si te gusta, te damos de alta GRATIS y consigues:
🧲 Más clientes en Benalmádena
👀 Más visibilidad en tu zona
💶 Subvenciones para crecer (te las gestionamos)

¿La activamos? Es gratis y son 2 minutos.`
  },
  {
    name: "Captación Bubui — Seguimiento",
    body: `Hola de nuevo {{nombre_negocio}} 👋

¿Pudiste ver lo de *Bubui*? Es la app de Benalmádena que te trae clientes, te da visibilidad y te busca subvenciones — todo GRATIS.

Sigue disponible tu alta sin coste 👇
{{enlace_bubui}}

Si prefieres que te lo cuente en 2 minutos por teléfono, dímelo y te llamo. 🙂`
  }
];

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // Siembra idempotente: crea las plantillas de captación de Bubui que aún
  // no existan en el workspace, para que estén listas para usar.
  const existing = await prisma.leadTemplate.findMany({
    where: { workspaceId: api.workspaceId, name: { in: BUBUI_DEFAULT_TEMPLATES.map((t) => t.name) } },
    select: { name: true }
  });
  const have = new Set(existing.map((e) => e.name));
  for (const tpl of BUBUI_DEFAULT_TEMPLATES) {
    if (have.has(tpl.name)) continue;
    await prisma.leadTemplate
      .create({ data: { workspaceId: api.workspaceId, name: tpl.name, channel: "whatsapp", body: tpl.body } })
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
