/**
 * POST /api/bubui/business/[id]/autofill
 *
 * La IA + datos reales (Google Places + web del negocio) proponen un BORRADOR
 * de redes y reseñas (Instagram/Facebook/TikTok/Trustpilot/Google). NO guarda
 * nada: el dueño lo verifica y guarda con el PATCH de perfil.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { autofillBusinessProfile } from "@/lib/bubui/autofill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const b = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { name: true, city: true, category: true, address: true, websiteUrl: true }
  });
  if (!b) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // BubuiBusiness no guarda web; Google Places la descubre y de ahí scrapeamos.
  const draft = await autofillBusinessProfile({
    name: b.name,
    city: b.city,
    category: b.category,
    address: b.address,
    website: b.websiteUrl
  });

  // Con { apply: true } (al terminar el alta) persiste lo encontrado SIN pisar
  // lo que el dueño ya tuviera: solo rellena los campos que estén vacíos. El
  // dueño lo verifica luego en el panel.
  const body = await req.json().catch(() => ({}));
  if (body?.apply) {
    const current = await prisma.bubuiBusiness.findUnique({
      where: { id: params.id },
      select: { websiteUrl: true, phone: true, address: true, googlePlaceId: true, instagramUrl: true, facebookUrl: true, tiktokUrl: true, trustpilotUrl: true, tripadvisorUrl: true }
    });
    const data: any = {};
    const setIfEmpty = (k: keyof typeof draft & string, cur: string | null) => {
      if (!cur && (draft as any)[k]) data[k] = (draft as any)[k];
    };
    setIfEmpty("googlePlaceId", current?.googlePlaceId ?? null);
    if (!current?.websiteUrl && draft.website) data.websiteUrl = draft.website;
    if (!current?.phone && draft.phone) data.phone = draft.phone;
    if (!current?.address && draft.address) data.address = draft.address;
    setIfEmpty("instagramUrl", current?.instagramUrl ?? null);
    setIfEmpty("facebookUrl", current?.facebookUrl ?? null);
    setIfEmpty("tiktokUrl", current?.tiktokUrl ?? null);
    setIfEmpty("trustpilotUrl", current?.trustpilotUrl ?? null);
    setIfEmpty("tripadvisorUrl", current?.tripadvisorUrl ?? null);
    if (Object.keys(data).length) {
      await prisma.bubuiBusiness.update({ where: { id: params.id }, data }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, draft });
}
