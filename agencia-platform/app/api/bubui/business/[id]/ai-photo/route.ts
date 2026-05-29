/**
 * POST /api/bubui/business/[id]/ai-photo
 *
 * Genera una foto pro de portada con IA. Gated por plan != "free".
 * Si STORAGE_* está configurado, sube el PNG al bucket y devuelve la URL
 * pública/firmada (lista para guardarla como `logoUrl` del negocio).
 * Si no, devuelve un data: URL inline para previsualización local.
 *
 * Auth: Bearer <businessId>:<random>
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { isPaidPlan } from "@/lib/bubui/plan";
import { generateBusinessHeroImage, isPhotoAiEnabled } from "@/lib/bubui/photo";
import {
  isStorageEnabled,
  uploadBuffer,
  signedDownloadUrl
} from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
// Generar imagen con IA tarda — pedimos margen de runtime al hosting.
export const maxDuration = 60;

const schema = z.object({
  prompt: z.string().trim().min(5).max(300),
  aspect: z.enum(["wide", "square"]).default("wide")
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!businessTokenAllows(req.headers.get("authorization"), params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  if (!isPhotoAiEnabled()) {
    return NextResponse.json(
      { error: { code: "ai_off", message: "Foto IA no configurada (falta OPENAI_API_KEY)." } },
      { status: 503 }
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos no válidos" } },
      { status: 400 }
    );
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: params.id },
    select: { name: true, category: true, plan: true }
  });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (!isPaidPlan(business.plan)) {
    return NextResponse.json(
      { error: { code: "plan_required", message: "Foto IA requiere Pro o Premium." } },
      { status: 402 }
    );
  }

  let pngBase64: string;
  try {
    const out = await generateBusinessHeroImage({
      businessName: business.name,
      category: business.category,
      userPrompt: parsed.data.prompt,
      aspect: parsed.data.aspect
    });
    pngBase64 = out.pngBase64;
  } catch (e: any) {
    console.error("[bubui ai-photo]", e?.message ?? e);
    return NextResponse.json(
      { error: { code: "generation_failed", message: "No se pudo generar la imagen. Inténtalo de nuevo." } },
      { status: 502 }
    );
  }

  // Si hay storage, subimos para que la URL sea estable.
  if (isStorageEnabled()) {
    try {
      const buf = Buffer.from(pngBase64, "base64");
      const key = `bubui/ai-photos/${params.id}/${Date.now()}-${parsed.data.aspect}.png`;
      await uploadBuffer({ s3Key: key, body: buf, contentType: "image/png" });
      const url = await signedDownloadUrl(key, 7 * 24 * 3600);
      return NextResponse.json({ ok: true, url, stored: true });
    } catch (e: any) {
      console.warn("[bubui ai-photo storage]", e?.message ?? e);
      // Si la subida falla, caemos a data URL para no perder el trabajo.
    }
  }

  return NextResponse.json({
    ok: true,
    url: `data:image/png;base64,${pngBase64}`,
    stored: false
  });
}
