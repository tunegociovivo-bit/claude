/**
 * POST /api/public/bubui-subvencion/[token]
 *
 * Validación de un clic por parte del COMERCIO: confirma que quiere que la
 * agencia le gestione las subvenciones. Sin login (token público de la
 * propuesta). Rate-limit por IP.
 */
import { NextResponse } from "next/server";
import { rateLimitPublic } from "@/lib/api/handler";
import { acceptProposalByToken } from "@/lib/bubui/subvenciones";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const limited = rateLimitPublic(req as any, { tag: "bubui-subvencion", limit: 30 });
  if (limited) return limited;

  const r = await acceptProposalByToken(params.token);
  if (!r.ok) {
    return NextResponse.json({ error: { code: "not_found", message: "Solicitud no encontrada" } }, { status: 404 });
  }
  return NextResponse.json({ ok: true, businessName: r.businessName, alreadyAccepted: !!r.alreadyAccepted });
}
