export function initialOnboardingStep(platform: string, explicitRegistration: boolean): number {
  // On Android a fresh install may lose Play Install Referrer on individual
  // devices. Registration lets the server recover the recorded web click;
  // guest mode cannot perform that recovery.
  return explicitRegistration || platform === "android" ? 2 : 0;
}

export function canExploreAsGuest(platform: string, hasPendingInvitation: boolean): boolean {
  return platform !== "android" && !hasPendingInvitation;
}
