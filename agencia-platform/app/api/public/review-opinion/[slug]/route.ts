/**
 * POST /api/public/review-opinion/[slug]
 *
 * Guarda una opinión dejada por un usuario en la URL "A" (/g/[slug]/opinar).
 * Público (sin auth), con rate-limit por IP. La opinión es privada: solo la ve
 * la agencia en el panel del cliente.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  body: z.string().trim().min(2).max(4000)
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const limited = rateLimitPublic(req, { tag: "review-opinion", limit: 20 });
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: "Escribe tu opinión." } }, { status: 400 });
  }

  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: { id: true }
  });
  if (!client) {
    return NextResponse.json({ error: { code: "not_found", message: "No encontrado" } }, { status: 404 });
  }

  await prisma.reviewOpinion.create({
    data: { clientId: client.id, name: parsed.data.name?.trim() || null, body: parsed.data.body.trim() }
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
