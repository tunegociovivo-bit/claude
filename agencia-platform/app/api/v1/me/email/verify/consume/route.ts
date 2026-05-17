/**
 * POST /api/v1/me/email/verify/consume
 * Body: { token: string }
 *
 * Confirma el email del usuario. NO requiere auth: el token mismo
 * es prueba de control sobre el inbox. Rate-limit por IP.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { consumeEmailVerification } from "@/lib/security/email-verification";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(32) });

export async function POST(req: NextRequest) {
  const rl = rateLimitPublic(req, { tag: "email-verify", limit: 30 });
  if (rl) return rl;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: parsed.error.message } },
      { status: 400 }
    );
  }
  const result = await consumeEmailVerification(parsed.data.token);
  if (!result.ok) {
    const msg =
      result.reason === "expired"
        ? "El enlace ha caducado. Pide uno nuevo desde tu perfil."
        : result.reason === "user_gone"
          ? "La cuenta asociada ya no existe."
          : "Enlace inválido o ya usado.";
    return NextResponse.json(
      { error: { code: result.reason, message: msg } },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
