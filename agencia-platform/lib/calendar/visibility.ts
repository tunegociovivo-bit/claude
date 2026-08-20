/** Calendar events are private per Hub user. */
export function calendarEventVisibility(userId?: string | null) {
  if (!userId) return { id: "__no_authenticated_calendar_owner__" };
  return {
    OR: [
      { ownerUserId: userId },
      // Legacy Google imports created before ownerUserId was populated.
      { ownerUserId: null, googleOwnerUserId: userId }
    ]
  };
}
