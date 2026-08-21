export type ChallengeFriendRow = {
  id: string;
  referralOfferId: string | null;
  name: string | null;
  phone: string | null;
  createdAt: Date;
  redeemed: boolean;
};

export function buildChallengeFriends(offerId: string, friends: ChallengeFriendRow[]) {
  return friends
    .filter((friend) => friend.referralOfferId === offerId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((friend) => ({
      customerId: friend.id,
      name: friend.name,
      phone: friend.phone,
      registered: true,
      redeemed: friend.redeemed,
      registeredAt: friend.createdAt.toISOString(),
    }));
}
