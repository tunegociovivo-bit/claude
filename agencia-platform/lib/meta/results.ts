type MetaAction = { action_type?: string; value?: string | number };
type MetaAdset = { optimization_goal?: string; promoted_object?: { custom_event_type?: string } };

const EVENT_ACTIONS: Record<string, string[]> = {
  COMPLETE_REGISTRATION: [
    "offsite_conversion.fb_pixel_complete_registration",
    "onsite_conversion.registration_completed",
    "complete_registration"
  ],
  LEAD: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]
};

export function metaResultActionCandidates(adsets: MetaAdset[], objective?: string | null): string[] {
  const customEvents = adsets
    .map((adset) => String(adset.promoted_object?.custom_event_type ?? "").toUpperCase())
    .filter(Boolean);
  for (const event of customEvents) {
    if (EVENT_ACTIONS[event]) return EVENT_ACTIONS[event];
  }
  if (adsets.some((adset) => String(adset.optimization_goal ?? "").toUpperCase() === "LEAD_GENERATION")
    || String(objective ?? "").toUpperCase() === "OUTCOME_LEADS") {
    return EVENT_ACTIONS.LEAD;
  }
  return EVENT_ACTIONS.LEAD;
}

/** Selects one Meta result event. Never sums aliases of the same conversion. */
export function metaResultValue(actions: MetaAction[] | null | undefined, candidates: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const candidate of candidates) {
    const action = actions.find((item) => String(item.action_type ?? "").toLowerCase() === candidate.toLowerCase());
    if (action) return Number(action.value ?? 0);
  }
  return 0;
}
