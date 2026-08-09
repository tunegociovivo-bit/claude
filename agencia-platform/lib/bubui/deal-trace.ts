/**
 * Traza SEGURA del flujo de un reto (custom-deal), para diagnosticar dónde se
 * corta la cadena WhatsApp → Play → app → alta → claim.
 *
 * Seguridad: NO se guarda IP ni PII. El `token` es el identificador PÚBLICO del
 * enlace del reto (no es un secreto ni un dato personal). `stage`/`platform`/
 * `appBuild` se acotan y se saneen (solo caracteres seguros). Best-effort:
 * cualquier fallo se traga; trazar nunca debe romper el flujo real.
 */
import { prisma } from "@/lib/db/prisma";

const TOKEN_RE = /^[a-f0-9]{8,64}$/i;
const SAFE = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[^\w.\-:]/g, "").slice(0, max) : undefined;

export async function recordDealTrace(input: {
  token: string;
  stage: string;
  platform?: string;
  appBuild?: string;
  source?: "server" | "client";
}): Promise<void> {
  try {
    const token = (input.token || "").toLowerCase();
    if (!TOKEN_RE.test(token)) return; // token no válido → no traza (evita basura)
    const stage = SAFE(input.stage, 40);
    if (!stage) return;
    await prisma.bubuiDealTrace.create({
      data: {
        token,
        stage,
        platform: SAFE(input.platform, 16) ?? null,
        appBuild: SAFE(input.appBuild, 16) ?? null,
        source: input.source === "client" ? "client" : "server"
      }
    });
  } catch {
    /* la observabilidad nunca rompe el flujo */
  }
}

export async function getDealTraces(token: string, limit = 200) {
  const t = (token || "").toLowerCase();
  if (!TOKEN_RE.test(t)) return [];
  return prisma.bubuiDealTrace.findMany({
    where: { token: t },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 500),
    select: { stage: true, platform: true, appBuild: true, source: true, createdAt: true }
  });
}
