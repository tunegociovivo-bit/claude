import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const PREFIX = process.env.API_KEY_PREFIX ?? "ag_";

// Genera una credencial individual para instalar el agente de un trabajador.
// El secreto solo se devuelve una vez y queda almacenado como hash bcrypt.
export const POST = withApi({ scope: "admin", admin: true }, async (req, { api }) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Selecciona un trabajador");
  const member = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: parsed.data.userId },
    include: { user: { select: { name: true, email: true } } }
  });
  if (!member) throw new ApiError(404, "member_not_found", "El trabajador no pertenece a esta empresa");
  const prefix = PREFIX + randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = await prisma.apiKey.create({ data: {
    workspaceId: api.workspaceId, userId: member.userId,
    name: `control-horario:${member.user.email}`,
    prefix, hashed: await bcrypt.hash(secret, 10), scopes: ["time_tracking:write"]
  } });
  return NextResponse.json({ id: key.id, token: `${prefix}.${secret}`, user: member.user.name || member.user.email });
});
