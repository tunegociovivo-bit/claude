/**
 * Atribución de reserva por IP para los enlaces de invitación (ver
 * /api/bubui/referral-click). Helpers compartidos entre el endpoint del clic
 * y verify-otp (que hace el match al registrarse un cliente sin `ref`).
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";

export function hashIpFromHeaders(headers: Headers): string | null {
  const raw = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Busca el código de invitación clicado más recientemente (<48h) desde la
 * misma IP. Se usa SOLO cuando el alta llega sin `ref` (el Install Referrer
 * se perdió). Ventana corta + misma IP = riesgo de falso positivo mínimo, y
 * el premio (cupón de bienvenida) no es sensible.
 */
export async function findRecentReferralClick(headers: Headers): Promise<{ code: string; offerId: string | null } | null> {
  const ipHash = hashIpFromHeaders(headers);
  if (!ipHash) return null;
  const click = await prisma.bubuiReferralClick.findFirst({
    where: { ipHash, createdAt: { gt: new Date(Date.now() - 48 * 3600_000) } },
    orderBy: { createdAt: "desc" },
    select: { code: true, offerId: true }
  });
  return click ? { code: click.code, offerId: click.offerId ?? null } : null;
}
