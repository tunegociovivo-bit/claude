export const META_LEAD_STAGES = ["new", "contacted", "qualified", "appointment", "proposal", "won", "lost", "invalid"] as const;
export type MetaLeadStage = typeof META_LEAD_STAGES[number];

export function stageDates(status: MetaLeadStage, now = new Date()) {
  if (status === "qualified") return { qualifiedAt: now };
  if (status === "appointment") return { appointmentAt: now };
  if (status === "proposal") return { proposalAt: now };
  if (status === "won") return { wonAt: now };
  if (status === "lost") return { lostAt: now };
  return {};
}

export function attributionMetrics(items: Array<{ status: string; revenueCents: number; campaignId?: string | null }>, spend = 0) {
  const total = items.length;
  const qualified = items.filter((item) => ["qualified", "appointment", "proposal", "won"].includes(item.status)).length;
  const appointments = items.filter((item) => ["appointment", "proposal", "won"].includes(item.status)).length;
  const proposals = items.filter((item) => ["proposal", "won"].includes(item.status)).length;
  const won = items.filter((item) => item.status === "won").length;
  const invalid = items.filter((item) => item.status === "invalid").length;
  const revenue = items.reduce((sum, item) => sum + Math.max(0, item.revenueCents), 0) / 100;
  return {
    total, qualified, appointments, proposals, won, invalid, revenue,
    qualificationRate: total ? qualified / total * 100 : 0,
    closeRate: qualified ? won / qualified * 100 : 0,
    costPerQualifiedLead: qualified ? spend / qualified : null,
    costPerSale: won ? spend / won : null,
    roas: spend > 0 ? revenue / spend : null
  };
}
