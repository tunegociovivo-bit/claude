const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function challengeFriendDomId(offerId: string, friendId: string) {
  return `challenge-friend-${offerId}-${friendId}`;
}

export function parseChallengeFollowupTarget(params: URLSearchParams) {
  const offerId = params.get("challenge");
  const friendId = params.get("friend");
  if (!offerId || !friendId || !SAFE_ID.test(offerId) || !SAFE_ID.test(friendId)) return null;
  return { offerId, friendId, domId: challengeFriendDomId(offerId, friendId) };
}
