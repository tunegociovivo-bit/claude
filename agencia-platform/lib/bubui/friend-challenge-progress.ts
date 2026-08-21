export type ReferredFriend = { id: string; name: string | null; referralOfferId?: string | null };
export type ChallengeParticipantRef = {
  offerId: string;
  friendCustomerId: string;
  status: string;
  registeredAt: Date;
};

/**
 * Resolve the friends belonging to one exact challenge. Participant rows are
 * canonical because a customer can participate in more than one challenge;
 * referralOfferId is only a compatibility fallback for historical records.
 */
export function friendsForChallengeOffer(
  offerId: string,
  friends: ReferredFriend[],
  participants: ChallengeParticipantRef[]
): ReferredFriend[] {
  const relevant = participants.filter((participant) => participant.offerId === offerId);
  const active = relevant
    .filter((participant) => !["declined", "lost"].includes(participant.status))
    .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime());
  if (relevant.length > 0) {
    const byId = new Map(friends.map((friend) => [friend.id, friend]));
    return active.map((participant) => byId.get(participant.friendCustomerId)).filter((friend): friend is ReferredFriend => !!friend);
  }
  return friends.filter((friend) => friend.referralOfferId === offerId);
}

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
