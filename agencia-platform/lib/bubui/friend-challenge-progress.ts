export type ReferredFriend = { id: string; name: string | null };

export function buildFriendChallengeProgress(
  friends: ReferredFriend[],
  purchaserIds: Set<string>,
  slots: number
) {
  return Array.from({ length: Math.max(0, slots) }, (_, index) => {
    const friend = friends[index];
    return {
      customerId: friend?.id ?? null,
      name: friend?.name?.trim() || null,
      initial: friend ? (friend.name?.trim()?.[0] || "?").toUpperCase() : null,
      registered: !!friend,
      redeemed: !!friend && purchaserIds.has(friend.id),
    };
  });
}
