export type FleetTarget = { deviceSerial: string; phoneKey: string; label: string };
export type FleetEntry = FleetTarget & { idempotencyKey: string; job?: { id: string; status: string; lastError?: string | null }; error?: string };
export type FleetPlan = { body: Record<string, unknown>; entries: FleetEntry[] };
export function createFleetPlan(targets: FleetTarget[], body: Record<string, unknown>, id = () => crypto.randomUUID()): FleetPlan {
  if (targets.length > 100) throw new Error("El máximo por encargo es de 100 móviles.");
  if (!targets.length || targets.some(t => !t.phoneKey) || new Set(targets.map(t => t.deviceSerial)).size !== targets.length) throw new Error("Selecciona móviles vinculados, sin duplicados.");
  return { body: structuredClone(body), entries: targets.map(t => ({ ...t, idempotencyKey: id() })) };
}
export async function dispatchFleetPlan(plan: FleetPlan, submit: (body: Record<string, unknown>) => Promise<NonNullable<FleetEntry['job']>>, progress: (plan: FleetPlan) => void): Promise<FleetPlan> {
  let current = { ...plan, entries: plan.entries.map(e => ({ ...e })) };
  for (let i = 0; i < current.entries.length; i++) {
    const entry = current.entries[i]!;
    if (entry.job) continue;
    try {
      const job = await submit({ ...current.body, deviceSerial: entry.deviceSerial, phoneKey: entry.phoneKey, idempotencyKey: entry.idempotencyKey });
      if (!job?.id) throw new Error("El servidor no confirmó el encargo. Reintenta para comprobarlo.");
      current.entries[i] = { ...entry, job, error: undefined };
    } catch (error) { current.entries[i] = { ...entry, error: error instanceof Error ? error.message : "No se pudo crear el encargo" }; }
    current = { ...current, entries: [...current.entries] }; progress(current);
  }
  return current;
}
