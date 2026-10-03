/**
 * Selección del perfil de Chrome que descarga las facturas de Google Ads.
 *
 * Google Ads no se reparte por cuenta (a diferencia de Meta): un único perfil
 * con las sesiones de Google se encarga de todas. Antes se elegía el perfil
 * registrado más antiguo, pero los registros nunca se borran: al reinstalar la
 * extensión nace un perfil nuevo y el antiguo, ya inexistente, seguía
 * "reservando" Google Ads para siempre. Ahora solo compiten los perfiles que
 * han dado señal de vida recientemente (la extensión consulta cada 30 s).
 */
export const GOOGLE_ADS_AGENT_ACTIVE_WINDOW_MS = 3 * 60 * 1000;

type AgentLike = { agentKey: string; createdAt: Date | string; lastHeartbeatAt: Date | string };

export function pickGoogleAdsAgentKey(agents: AgentLike[], now = new Date()): string | null {
  const activeSince = now.getTime() - GOOGLE_ADS_AGENT_ACTIVE_WINDOW_MS;
  const active = agents.filter((agent) => new Date(agent.lastHeartbeatAt).getTime() >= activeSince);
  if (!active.length) return null;
  // Entre varios perfiles activos se mantiene un criterio estable: el más
  // antiguo, para que Google Ads no salte de perfil en cada consulta.
  active.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.agentKey.localeCompare(b.agentKey));
  return active[0].agentKey;
}
