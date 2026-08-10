const INTENTS: Array<[string, RegExp]> = [
  ["CANCELAR CITA", /(cancel|anular|storn|annul)\w*/i],
  ["RESERVAR CITA", /(cita|reserv|booking|appointment|termin|rendez[- ]?vous|prenot)\w*/i],
  ["INFORMACIÓN PRECIOS", /(precio|tarifa|coste|price|cost|preis|tarif|prix|prezzo)\w*/i],
  ["HORARIO", /(horario|abiert|cerrad|opening|hours|offnungs|uhrzeit|horaire|orari)\w*/i],
  ["UBICACIÓN", /(direcci[oó]n|ubicaci[oó]n|donde|dove|address|location|adresse|indirizzo|standort)\w*/i],
];

export function classifyCallIntent(summary: string | null, transcript: string | null): string | null {
  const text = `${summary ?? ""} ${transcript ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!text) return null;
  return INTENTS.find(([, pattern]) => pattern.test(text))?.[0] ?? "INFORMACIÓN GENERAL";
}
