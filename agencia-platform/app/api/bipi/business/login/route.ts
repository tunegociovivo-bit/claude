/**
 * POST /api/bipi/business/login
 *
 * Login simple del dueño del negocio: email + password. Devuelve un
 * token opaco que el cliente guarda en localStorage. El token es
 * `businessId:hex(random16)` — para v1 vale; en v2 saltamos a JWT.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bipiBusiness.findUnique({ where: { ownerEmail: parsed.data.email } });
  if (!business) {
    return NextResponse.json({ error: { code: "invalid_credentials", message: "Email o contraseña no válidos" } }, { status: 401 });
  }
  const ok = await bcrypt.compare(parsed.data.password, business.ownerPasswordHash);
  if (!ok) {
    return NextResponse.json({ error: { code: "invalid_credentials", message: "Email o contraseña no válidos" } }, { status: 401 });
  }
  const token = `${business.id}:${randomBytes(16).toString("hex")}`;
  return NextResponse.json({
    ok: true,
    businessId: business.id,
    name: business.name,
    slug: business.slug,
    token
  });
}
