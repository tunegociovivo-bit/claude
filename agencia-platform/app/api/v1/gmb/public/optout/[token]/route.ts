/**
 * Opt-out público de una campaña de reseñas. POST → añade a la suppression list y marca el contacto
 * como opted_out (idempotente). GET → estado. Público (token = optOutToken del contacto).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

async function findContact(token: string) {
  return prisma.gmbReviewContact.findUnique({ where: { optOutToken: token } });
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const c = await findContact(params.token);
  if (!c) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, optedOut: c.status === "opted_out" });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const rl = rateLimitPublic(req as any, { tag: "gmb-optout", limit: 60 });
  if (rl && (rl as any).ok === false) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const c = await findContact(params.token);
  if (!c) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  // Suppression (idempotente por unique [workspaceId, contactHash]) + estado del contacto.
  await prisma.gmbSuppression.createMany({ data: [{ workspaceId: c.workspaceId, contactHash: c.contactHash, reason: "opt_out" }], skipDuplicates: true }).catch(() => {});
  await prisma.gmbReviewContact.updateMany({ where: { id: c.id, workspaceId: c.workspaceId }, data: { status: "opted_out" } });
  return NextResponse.json({ ok: true, optedOut: true });
}
