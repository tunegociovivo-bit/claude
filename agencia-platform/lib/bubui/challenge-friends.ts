export type ChallengeFriendRow = {
  id: string;
  referralOfferId: string | null;
  name: string | null;
  phone: string | null;
  createdAt: Date;
  redeemed: boolean;
};

export function buildChallengeFriends(offerId: string, friends: ChallengeFriendRow[], participants: { offerId: string; friendCustomerId: string; registeredAt: Date }[] = []) {
  const relevant = participants.filter((participant) => participant.offerId === offerId);
  const membership = new Map(relevant.map((participant) => [participant.friendCustomerId, participant.registeredAt]));
  return friends
    .filter((friend) => relevant.length ? membership.has(friend.id) : friend.referralOfferId === offerId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((friend) => ({
      customerId: friend.id,
      name: friend.name,
      phone: friend.phone,
      registered: true,
      redeemed: friend.redeemed,
      registeredAt: (membership.get(friend.id) ?? friend.createdAt).toISOString(),
    }));
}
