type MetaGuardAnnouncementInput = {
  minutes: number;
  reason?: string | null;
  firstName?: string | null;
};

function humanReason(reason?: string | null): string {
  if (!reason) return "una limitación temporal comunicada por Meta";
  const usage = reason.match(/uso\s+(\d+(?:[.,]\d+)?)%/i);
  if (usage) return `uso de cuota ${usage[1]}%`;
  if (/estimated_time_to_regain_access/i.test(reason)) return "un tiempo de recuperación indicado por Meta";
  if (/error Meta\s+(\d+)/i.test(reason)) return `una respuesta de limitación de la API (${reason.match(/error Meta\s+(\d+)/i)?.[1]})`;
  return "una limitación temporal comunicada por Meta";
}

export function buildMetaGuardAnnouncement({ minutes, reason, firstName }: MetaGuardAnnouncementInput): string {
  const greeting = firstName ? `${firstName}, atención. ` : "Atención. ";
  return (
    `${greeting}La API de Meta ha activado una pausa preventiva por ${humanReason(reason)}. ` +
    `Durante unos ${Math.max(1, Math.ceil(minutes))} minutos el Hub no enviará nuevas publicaciones ni cambios automáticos. ` +
    `Las campañas activas continúan publicándose normalmente en Meta. No necesitas intervenir; el Hub reanudará las operaciones cuando termine la pausa.`
  );
}
