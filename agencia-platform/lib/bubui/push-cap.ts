/**
 * Límite anti-fatiga de push por cliente y día.
 *
 * Un usuario que recibe demasiados push acaba borrando la app. Por eso se
 * limita cuántos push recibe al día (configurable por el admin; 0 = ilimitado).
 *
 * El conteo vive en BubuiCustomer.pushDayKey / pushSentToday y se resetea solo
 * al cambiar de día (clave "YYYY-MM-DD" en UTC). Contamos MENSAJES (no canales):
 * un mismo aviso que llega por web y móvil cuenta como 1.
 */
import { prisma } from "@/lib/db/prisma";
import { getMaxPushPerDay } from "./growth-settings";

export { getMaxPushPerDay };

export function pushDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** ¿Puede este cliente recibir otro push hoy? `cap` opcional para no releer el
 *  ajuste en bucles. cap<=0 → sin límite. */
export async function canReceivePush(customerId: string, cap?: number): Promise<boolean> {
  const limit = cap ?? (await getMaxPushPerDay());
  if (limit <= 0) return true;
  const c = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { pushDayKey: true, pushSentToday: true }
  });
  const used = c && c.pushDayKey === pushDayKey() ? c.pushSentToday : 0;
  return used < limit;
}

/** Registra que se le envió un push hoy (resetea el contador si cambió el día). */
export async function recordPushSent(customerId: string): Promise<void> {
  const today = pushDayKey();
  const c = await prisma.bubuiCustomer.findUnique({
    where: { id: customerId },
    select: { pushDayKey: true }
  });
  await prisma.bubuiCustomer
    .update({
      where: { id: customerId },
      data:
        c?.pushDayKey === today
          ? { pushSentToday: { increment: 1 } }
          : { pushDayKey: today, pushSentToday: 1 }
    })
    .catch(() => {});
}

/** Para envíos masivos: dado el conjunto de candidatos, devuelve quién puede
 *  recibir push hoy (en una sola consulta). cap<=0 → todos. */
export async function filterAllowedForPush(
  customerIds: string[],
  cap: number
): Promise<{ allowed: Set<string>; today: string; usedToday: Map<string, number> }> {
  const today = pushDayKey();
  const usedToday = new Map<string, number>();
  if (cap <= 0 || customerIds.length === 0) {
    return { allowed: new Set(customerIds), today, usedToday };
  }
  const rows = await prisma.bubuiCustomer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, pushDayKey: true, pushSentToday: true }
  });
  const usage = new Map(rows.map((r) => [r.id, r.pushDayKey === today ? r.pushSentToday : 0]));
  const allowed = new Set<string>();
  for (const id of customerIds) {
    const used = usage.get(id) ?? 0;
    usedToday.set(id, used);
    if (used < cap) allowed.add(id);
  }
  return { allowed, today, usedToday };
}

/** Suma 1 al contador de hoy para un lote de clientes que SÍ recibieron push.
 *  `usedToday` indica cuántos llevaban hoy (para saber si reset o increment). */
export async function recordPushBatch(customerIds: string[], usedToday: Map<string, number>): Promise<void> {
  if (customerIds.length === 0) return;
  const today = pushDayKey();
  const toIncrement = customerIds.filter((id) => (usedToday.get(id) ?? 0) > 0);
  const toReset = customerIds.filter((id) => (usedToday.get(id) ?? 0) === 0);
  if (toIncrement.length) {
    await prisma.bubuiCustomer
      .updateMany({ where: { id: { in: toIncrement } }, data: { pushSentToday: { increment: 1 } } })
      .catch(() => {});
  }
  if (toReset.length) {
    await prisma.bubuiCustomer
      .updateMany({ where: { id: { in: toReset } }, data: { pushDayKey: today, pushSentToday: 1 } })
      .catch(() => {});
  }
}
