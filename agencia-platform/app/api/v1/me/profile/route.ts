/**
 * Endpoint para que el usuario logueado edite su PROPIO perfil
 * (nombre, teléfono, foto, contraseña). NO permite cambiar email ni rol.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().nullable().optional(),
  image: z.string().url().nullable().optional(),
  password: z.string().min(8).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const data: any = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone;
  if (parsed.data.image !== undefined) data.image = parsed.data.image;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const updated = await prisma.user.update({
    where: { id: api.userId },
    data,
    select: { id: true, name: true, email: true, image: true, phone: true }
  });
  return NextResponse.json(updated);
});
