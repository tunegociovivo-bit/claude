/**
 * Admin · Configuración de crecimiento de Bubui (cupones-reto).
 *   GET → { altMinReferrals, expiryWarnDays }
 *   PUT { altMinReferrals?, expiryWarnDays? } → guarda los parámetros.
 *
 *  - altMinReferrals: amigos dados de alta para desbloquear la activación
 *    alternativa (reseña/foto) de los cupones-reto.
 *  - expiryWarnDays: días antes de caducar en los que se avisa por push.
 *
 * Auth: sesión admin (NextAuth, role ADMIN).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import {
  getAltActionMinReferrals,
  setAltActionMinReferrals,
  getChallengeExpiryWarnDays,
  setChallengeExpiryWarnDays,
  getChallengeExpiryDays,
  setChallengeExpiryDays,
  getMaxPushPerDay,
  setMaxPushPerDay
} from "@/lib/bubui/growth-settings";

export const dynamic = "force-dynamic";

const schema = z.object({
  altMinReferrals: z.number().int().min(0).max(1000).optional(),
  expiryWarnDays: z.number().int().min(1).max(60).optional(),
  expiryDays: z.number().int().min(1).max(365).optional(),
  maxPushPerDay: z.number().int().min(0).max(50).optional()
});

async function readAll() {
  const [altMinReferrals, expiryWarnDays, expiryDays, maxPushPerDay] = await Promise.all([
    getAltActionMinReferrals(),
    getChallengeExpiryWarnDays(),
    getChallengeExpiryDays(),
    getMaxPushPerDay()
  ]);
  return { altMinReferrals, expiryWarnDays, expiryDays, maxPushPerDay };
}

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json(await readAll());
}

export async function PUT(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  if (parsed.data.altMinReferrals !== undefined) await setAltActionMinReferrals(parsed.data.altMinReferrals);
  if (parsed.data.expiryWarnDays !== undefined) await setChallengeExpiryWarnDays(parsed.data.expiryWarnDays);
  if (parsed.data.expiryDays !== undefined) await setChallengeExpiryDays(parsed.data.expiryDays);
  if (parsed.data.maxPushPerDay !== undefined) await setMaxPushPerDay(parsed.data.maxPushPerDay);
  return NextResponse.json(await readAll());
}
