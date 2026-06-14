/**
 * Utilidades del plan "Bubui Plus" (suscripción del usuario).
 *
 * - isPlusActive: ¿el usuario tiene plan plus vigente?
 * - getPlusEarlyAccessHours / setPlusEarlyAccessHours: ventana de "acceso
 *   anticipado" a ofertas. Si es > 0, los usuarios SIN Plus ven cada oferta
 *   solo a partir de N horas después de generarse (los Plus, al instante).
 *   Por defecto 0 = desactivado (no cambia el comportamiento actual).
 */
import { prisma } from "@/lib/db/prisma";

export function isPlusActive(c: { plan: string | null; planExpiresAt: Date | null } | null | undefined): boolean {
  if (!c) return false;
  return c.plan === "plus" && (!c.planExpiresAt || c.planExpiresAt > new Date());
}

const ENABLED_KEY = "plus_enabled";

/**
 * ¿Se muestra el botón/alta de Bubui Plus en la app? El admin lo controla
 * desde el panel. Por defecto FALSE: la suscripción permanece oculta hasta que
 * haya suficientes comercios y se active manualmente. (Quien YA sea Plus sigue
 * viendo su estado y sus regalos aunque esté oculto para nuevos usuarios.)
 */
export async function getPlusEnabled(): Promise<boolean> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: ENABLED_KEY } });
  return row?.value === "true";
}

export async function setPlusEnabled(enabled: boolean): Promise<boolean> {
  await prisma.bubuiSetting.upsert({
    where: { key: ENABLED_KEY },
    create: { key: ENABLED_KEY, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" }
  });
  return enabled;
}

const EARLY_KEY = "plus_early_access_hours";

export async function getPlusEarlyAccessHours(): Promise<number> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: EARLY_KEY } });
  if (!row) return 0;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function setPlusEarlyAccessHours(hours: number): Promise<number> {
  const safe = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 0;
  await prisma.bubuiSetting.upsert({
    where: { key: EARLY_KEY },
    create: { key: EARLY_KEY, value: String(safe) },
    update: { value: String(safe) }
  });
  return safe;
}
