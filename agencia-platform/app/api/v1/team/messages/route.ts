import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

// GET /api/v1/team/messages?limit=100
// Devuelve los últimos N mensajes del chat de equipo, más recientes
// al final (orden cronológico).
export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const rows = await (prisma as any).teamMessage.findMany({
    where: { workspaceId: api.workspaceId },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const items = rows
    .map((r: any) => ({
      id: r.id,
      body: r.body,
      references: r.references ?? null,
      createdAt: r.createdAt.toISOString(),
      author: r.author
    }))
    .reverse();
  return NextResponse.json({ items });
});

const createSchema = z.object({
  body: z.string().min(1).max(5000)
});

// POST /api/v1/team/messages  { body }
// Parser básico de referencias: detecta tokens "#tarea:<id>" y
// "#proyecto:<id>" en el body y los guarda en references[].
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const references: { kind: "task" | "project"; id: string }[] = [];
  const re = /#(tarea|proyecto):([a-z0-9_-]{4,40})/gi;
  for (const m of parsed.data.body.matchAll(re)) {
    const kind = m[1].toLowerCase() === "tarea" ? "task" : "project";
    references.push({ kind, id: m[2] });
  }

  const msg = await (prisma as any).teamMessage.create({
    data: {
      workspaceId: api.workspaceId,
      authorId: api.userId,
      body: parsed.data.body,
      references: references.length > 0 ? references : null
    },
    include: { author: { select: { id: true, name: true, email: true, image: true } } }
  });
  return NextResponse.json(
    {
      id: msg.id,
      body: msg.body,
      references: msg.references ?? null,
      createdAt: msg.createdAt.toISOString(),
      author: msg.author
    },
    { status: 201 }
  );
});
