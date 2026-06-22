/**
 * POST /api/bubui/business/[id]/activate
 * Body: { email, password }
 *
 * Activa una ficha pre-creada (claim): la pone en vivo (active=true), fija el
 * email + contraseña reales del dueño para que pueda volver a entrar, marca
 * claimedAt e invalida el claimToken. Requiere la sesión emitida por /claim.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { triggerScanInBackground } from "@/lib/bubui/subvenciones";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres")
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sesión no válida." } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  // El email no puede estar en uso por OTRO negocio.
  const clash = await prisma.bubuiBusiness.findFirst({ where: { ownerEmail: email, NOT: { id: params.id } }, select: { id: true } });
  if (clash) {
    return NextResponse.json({ error: { code: "email_taken", message: "Ese email ya está registrado en otro negocio." } }, { status: 409 });
  }

  await prisma.bubuiBusiness.update({
    where: { id: params.id },
    data: {
      ownerEmail: email,
      ownerPasswordHash: await bcrypt.hash(parsed.data.password, 10),
      active: true,
      claimedAt: new Date(),
      claimToken: null,
      claimExpiresAt: null
    }
  });

  // Cazador de Subvenciones: busca ayudas del nicho para la ficha recién
  // activada (en segundo plano, no bloquea la respuesta).
  triggerScanInBackground(params.id);

  return NextResponse.json({ ok: true });
}
