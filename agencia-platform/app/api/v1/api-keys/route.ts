import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const PREFIX = process.env.API_KEY_PREFIX ?? "ag_";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const keys = await prisma.apiKey.findMany({
    where: { workspaceId: api.workspaceId, revokedAt: null },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, createdAt: true, expiresAt: true }
  });
  return NextResponse.json({ items: keys });
});

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  if (!body?.name) throw new ApiError(400, "validation_error", "name requerido");

  const prefix = PREFIX + randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const hashed = await bcrypt.hash(secret, 10);

  const key = await prisma.apiKey.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      name: body.name,
      prefix,
      hashed,
      scopes: body.scopes ?? ["*"]
    }
  });

  // Esta es la única vez que se ve el secreto en claro
  return NextResponse.json({ id: key.id, token: `${prefix}.${secret}`, scopes: key.scopes });
});
