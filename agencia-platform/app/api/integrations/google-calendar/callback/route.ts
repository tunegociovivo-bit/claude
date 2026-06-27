/**
 * GET /api/integrations/google-calendar/callback?code=...&state=...
 *
 * Recibe el redirect de Google tras el consentimiento del usuario.
 * Valida state (HMAC firmado en el connect), intercambia code por
 * tokens y guarda la conexión en BD. Redirige a /perfil con un flag
 * en la query (success o error) para que la UI dé feedback.
 */

import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { exchangeCodeForTokens, getUserInfo } from "@/lib/integrations/google-calendar/oauth";
import { createWatchForConnection } from "@/lib/integrations/google-calendar/watch";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirect = (qs: string) => NextResponse.redirect(`${base}/perfil${qs}`);

  if (errorParam) return redirect(`?gcal=denied`);
  if (!code || !state) return redirect(`?gcal=invalid`);

  const parsed = verifyState(state);
  if (!parsed) return redirect(`?gcal=bad_state`);
  if (Date.now() - parsed.ts > 10 * 60 * 1000) return redirect(`?gcal=expired_state`);

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google sólo manda refresh_token la primera vez (o si se fuerza
      // prompt=consent). Si no llega, no podemos sincronizar a largo
      // plazo y se rompería al cabo de 1h. Forzamos al user a volver
      // a iniciar manualmente desde Google Account > Security >
      // Third-party apps > revocar > reconectar.
      return redirect(`?gcal=no_refresh`);
    }
    const info = await getUserInfo(tokens.access_token);
    const conn = await prisma.googleCalendarConnection.upsert({
      where: { userId_workspaceId: { userId: parsed.userId, workspaceId: parsed.workspaceId } },
      create: {
        userId: parsed.userId,
        workspaceId: parsed.workspaceId,
        googleAccountEmail: info.email,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        syncToken: null
      },
      update: {
        googleAccountEmail: info.email,
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        syncToken: null, // reset por seguridad: forzar full sync inicial
        lastError: null,
        pullEnabled: true,
        pushEnabled: true
      }
    });
    // Registrar watch channel para push notifications. No bloqueante:
    // si falla (porque el dominio aún no está verificado en Search
    // Console o estamos en localhost), la cuenta queda conectada y
    // el cron de polling cada 15min sigue siendo el plan B.
    void createWatchForConnection(conn).catch((e) =>
      console.warn("[gcal watch] no se pudo crear canal:", e?.message ?? e)
    );
    // Backfill inmediato: empuja las tareas con fecha ya existentes a Google
    // para que aparezcan al instante (sin esperar al cron de 15 min).
    if (conn.pushEnabled) {
      void import("@/lib/integrations/google-calendar/sync")
        .then((m) => m.pushPendingTasksForConnection(conn))
        .catch((e) => console.warn("[gcal backfill tasks]", e?.message ?? e));
    }
    return redirect(`?gcal=connected`);
  } catch (e: any) {
    console.warn("[gcal callback]", e?.message ?? e);
    return redirect(`?gcal=failed`);
  }
}

function verifyState(s: string): { userId: string; workspaceId: string; ts: number } | null {
  const [b64, sig] = s.split(".");
  if (!b64 || !sig) return null;
  const secret = process.env.NEXTAUTH_SECRET ?? "dev";
  const expected = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
