export const MIN_INSTAGRAM_AGENT_VERSION = "0.21.28";

export function supportsAudienceDiscovery(version: string | null) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split(".").map(Number);
  const required = MIN_INSTAGRAM_AGENT_VERSION.split(".").map(Number);
  for (let i = 0; i < required.length; i++) {
    if (actual[i] !== required[i]) return actual[i] > required[i];
  }
  return true;
}
