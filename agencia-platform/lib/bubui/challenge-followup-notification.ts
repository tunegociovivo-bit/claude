export function challengeNotificationDestination(type: string) {
  if (type !== "challenge_followup") return null;
  return { panelTab: "nicho" as const, anchor: "retos-activos" };
}
