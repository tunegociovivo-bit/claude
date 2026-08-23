const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function challengeFriendDomId(offerId: string, friendId: string) {
  return `challenge-friend-${offerId}-${friendId}`;
}

export function parseChallengeFollowupTarget(params: URLSearchParams) {
  const offerId = params.get("challenge");
  const friendId = params.get("friend");
  const businessId = params.get("business");
  if (!offerId || !friendId || !businessId || !SAFE_ID.test(offerId) || !SAFE_ID.test(friendId) || !SAFE_ID.test(businessId)) return null;
  return { offerId, friendId, businessId, domId: challengeFriendDomId(offerId, friendId), panelTab: "nicho" as const };
}
