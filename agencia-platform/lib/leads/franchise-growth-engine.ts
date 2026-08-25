export type FranchiseSignal = {
  type: "new_locations" | "franchise_expansion" | "marketing_hiring" | "investment" | "ownership_change" | "launch" | "reviews" | "visibility" | "listing_errors" | "other";
  strength: number;
  observedAt: string;
  evidence: string;
  sourceUrl?: string | null;
};

export function scoreFranchiseOpportunity(input: { signals: FranchiseSignal[]; auditScore: number; verifiedDecisionMaker: boolean; networkSize: number }) {
  const expansionTypes = new Set(["new_locations", "franchise_expansion", "marketing_hiring", "investment", "ownership_change", "launch"]);
  const expansion = input.signals.filter((signal) => expansionTypes.has(signal.type));
  const strongest = Math.max(0, ...input.signals.map((signal) => Math.max(0, Math.min(100, signal.strength))));
  let score = Math.round(input.auditScore * 0.35 + strongest * 0.3 + Math.min(20, input.networkSize / 4));
  const reasons: string[] = [];
  if (expansion.length) { score += 15; reasons.push("Expansión o cambio reciente"); }
  if (input.auditScore >= 55) reasons.push("Problemas demostrables en la red local");
  if (input.verifiedDecisionMaker) { score += 10; reasons.push("Responsable de marketing verificado"); }
  else score -= 8;
  score = Math.max(0, Math.min(100, score));
  return { score, tier: score >= 75 ? "actuar_ahora" : score >= 50 ? "prioritaria" : score >= 35 ? "nutrir" : "observar", reasons } as const;
}

export function buildFranchisePilot(input: { brand: string; sampled: number; auditScore: number }) {
  const interventionLocations = Math.max(5, Math.min(15, Math.floor(input.sampled / 4) || 5));
  return {
    title: `Piloto controlado de 60 días para ${input.brand}`,
    durationDays: 60,
    interventionLocations,
    controlLocations: interventionLocations,
    successMetrics: ["visibilidad local", "solicitudes de ruta", "llamadas", "reseñas respondidas", "conversión de ficha"],
    design: "Comparación antes/después y contra un grupo de control equivalente; sin atribuir ingresos no observados.",
    recommendedBecause: input.auditScore >= 55 ? "La red presenta incidencias suficientes para medir una mejora real." : "Permite validar el impacto antes de ampliar el servicio."
  };
}

export function buildFranchiseCadence(startAt: string) {
  const start = new Date(startAt);
  const step = (day: number, channel: "email" | "linkedin", purpose: string) => ({
    day,
    channel,
    purpose,
    scheduledAt: new Date(start.getTime() + day * 86_400_000).toISOString(),
    status: "pending" as const,
    requiresApproval: true,
    stopOnReply: true
  });
  return [
    step(0, "email", "Auditoría y piloto específico"),
    step(3, "email", "Nueva evidencia no incluida en el primer correo"),
    step(6, "email", "Segundo responsable con ángulo adaptado a su cargo"),
    step(10, "linkedin", "Contacto breve con referencia a la auditoría"),
    step(15, "email", "Actualización de incidencias desde la auditoría")
  ];
}

export function checkFranchiseExclusivity(target: { category: string; provinces: string[] }, existing: Array<{ client: string; category: string; provinces: string[] }>) {
  const category = target.category.trim().toLowerCase();
  const provinces = new Set(target.provinces.map((province) => province.trim().toLowerCase()));
  const conflicts = existing.filter((entry) => entry.category.trim().toLowerCase() === category && entry.provinces.some((province) => provinces.has(province.trim().toLowerCase())));
  return { allowed: conflicts.length === 0, conflicts };
}

export function summarizeFranchiseLearning(records: Array<{ outcome: string; role?: string | null; signalTypes?: string[] }>) {
  const successes = records.filter((record) => record.outcome === "meeting" || record.outcome === "won");
  const best = (values: string[]) => {
    const counts = new Map<string, number>();
    values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return {
    total: records.length,
    meetingOrWinRate: records.length ? Math.round((successes.length / records.length) * 1000) / 10 : 0,
    bestRole: best(successes.map((record) => record.role ?? "")),
    bestSignal: best(successes.flatMap((record) => record.signalTypes ?? []))
  };
}
