/**
 * GET /api/v1/meta/guard-speak
 *
 * Devuelve audio MP3 con Sonia avisando (con su voz de ElevenLabs) de que
 * Meta está limitando la cuenta y ha pausado las publicaciones. El cliente
 * lo reproduce cuando detecta que el guardián ha entrado en enfriamiento.
 *
 * - Si NO estamos en enfriamiento → 204 (nada que decir).
 * - Si ElevenLabs no está configurado o falla → 204 (el cliente cae a un
 *   aviso por voz del navegador).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { callerIsAdmin } from "@/lib/api/permissions";
import { getMetaGuardState } from "@/lib/integrations/meta-rate-guard";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";
import { buildMetaGuardAnnouncement } from "@/lib/integrations/meta-guard-message";

export const dynamic = "force-dynamic";

function firstNameOf(name: string | null, email: string | null): string | null {
  if (name && name.trim()) {
    const f = name.trim().split(/\s+/)[0];
    if (f.length >= 2) return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
  }
  if (email) {
    const local = email.split("@")[0]?.split(/[.\-_]/)?.[0];
    if (local && local.length >= 2) return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }
  return null;
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) return new NextResponse(null, { status: 204 });
  const state = await getMetaGuardState();
  if (!state.inCooldown) return new NextResponse(null, { status: 204 });

  let firstName: string | null = null;
  if (api.userId) {
    const u = await prisma.user.findUnique({
      where: { id: api.userId },
      select: { name: true, email: true }
    });
    firstName = firstNameOf(u?.name ?? null, u?.email ?? null);
  }

  const min = Math.max(1, Math.ceil(state.cooldownMsLeft / 60000));
  const text = buildMetaGuardAnnouncement({ minutes: min, reason: state.cooldownReason, firstName });

  try {
    const buf = await elevenlabsSynthesize({ workspaceId: api.workspaceId, text });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Sonia-Text": encodeURIComponent(text.slice(0, 300))
      }
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
});
