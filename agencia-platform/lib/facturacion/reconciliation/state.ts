export function profileForForcedReconciliation(profile: unknown, now = new Date()): Record<string, unknown> {
  const current = profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : {};
  return {
    ...current,
    forceRequestedAt: now.toISOString(),
    retryState: { attempts: 0, lastFailureAt: null, notifiedAt: null }
  };
}
