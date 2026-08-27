export function profileForForcedReconciliation(profile: unknown): Record<string, unknown> {
  const current = profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : {};
  return { ...current, retryState: { attempts: 0, lastFailureAt: null, notifiedAt: null } };
}
