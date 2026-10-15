import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { getWorkspaceSettings } from "@/lib/settings";

export type RadarConfigView = {
  times: string[];
  days: number[];
  notifyPhones: string[];
  notifyEmails: string[];
};

const DEFAULTS: RadarConfigView = { times: ["08:00"], days: [1, 2, 3, 4, 5, 6, 7], notifyPhones: [], notifyEmails: [] };
export const MAX_TIMES = 6;
export const MAX_NOTIFY_PHONES = 10;
export const MAX_NOTIFY_EMAILS = 10;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function getRadarConfig(workspaceId: string): Promise<RadarConfigView> {
  const row = await prisma.radarConfig.findUnique({ where: { workspaceId } });
  if (!row) return { ...DEFAULTS };
  return {
    times: row.times.length ? row.times : DEFAULTS.times,
    days: row.days.length ? row.days : DEFAULTS.days,
    notifyPhones: row.notifyPhones,
    notifyEmails: row.notifyEmails,
  };
}

export function validateConfigPatch(
  patch: Partial<RadarConfigView>,
  countryCode: string
): { ok: true; value: Partial<RadarConfigView> } | { ok: false; error: string } {
  const value: Partial<RadarConfigView> = {};
  if (patch.times) {
    const times = [...new Set(patch.times.map((t) => t.trim()))].filter(Boolean);
    if (times.some((t) => !TIME_RE.test(t))) return { ok: false, error: "Las horas deben tener formato HH:MM (p. ej. 08:00)." };
    if (times.length === 0) return { ok: false, error: "Pon al menos una hora de revisión." };
    if (times.length > MAX_TIMES) return { ok: false, error: `Como mucho ${MAX_TIMES} horas de revisión.` };
    value.times = times.sort();
  }
  if (patch.days) {
    const days = [...new Set(patch.days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
    if (days.length === 0) return { ok: false, error: "Elige al menos un día de la semana." };
    value.days = days;
  }
  if (patch.notifyPhones) {
    const phones: string[] = [];
    for (const raw of patch.notifyPhones) {
      const n = normalizePhone(raw, countryCode);
      if (!n) return { ok: false, error: `El teléfono «${raw}» no es válido.` };
      if (!phones.includes(n)) phones.push(n);
    }
    if (phones.length > MAX_NOTIFY_PHONES) return { ok: false, error: `Como mucho ${MAX_NOTIFY_PHONES} teléfonos.` };
    value.notifyPhones = phones;
  }
  if (patch.notifyEmails) {
    const emails: string[] = [];
    for (const raw of patch.notifyEmails) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      if (!EMAIL_RE.test(e)) return { ok: false, error: `El email «${raw}» no es válido.` };
      if (!emails.includes(e)) emails.push(e);
    }
    if (emails.length > MAX_NOTIFY_EMAILS) return { ok: false, error: `Como mucho ${MAX_NOTIFY_EMAILS} emails.` };
    value.notifyEmails = emails;
  }
  return { ok: true, value };
}

export async function saveRadarConfig(workspaceId: string, patch: Partial<RadarConfigView>): Promise<RadarConfigView> {
  const settings = await getWorkspaceSettings(workspaceId);
  const check = validateConfigPatch(patch, settings.whatsapp.countryCode || "34");
  if (!check.ok) throw new Error(check.error);
  const v = check.value;
  await prisma.radarConfig.upsert({
    where: { workspaceId },
    update: {
      ...(v.times ? { times: v.times } : {}),
      ...(v.days ? { days: v.days } : {}),
      ...(v.notifyPhones ? { notifyPhones: v.notifyPhones } : {}),
      ...(v.notifyEmails ? { notifyEmails: v.notifyEmails } : {}),
    },
    create: {
      workspaceId,
      times: v.times ?? DEFAULTS.times,
      days: v.days ?? DEFAULTS.days,
      notifyPhones: v.notifyPhones ?? [],
      notifyEmails: v.notifyEmails ?? [],
    },
  });
  return getRadarConfig(workspaceId);
}
