import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildGmbReviewUrl, extractPlaceId } from "@/lib/reviews/gmb-link";

// Schema base con campos comunes a los dos modos. Validación condicional
// por modo más abajo (refine).
const reviewClientCreate = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "El slug debe ser minúsculas, números y guiones"),
    name: z.string().min(1).max(120),
    webUrl: z.string().url().optional().or(z.literal("")),
    mode: z.enum(["AI_GENERATOR", "STAR_REDIRECT"]).default("AI_GENERATOR"),
    // AI_GENERATOR
    destinationUrl: z.string().url().optional().or(z.literal("")),
    topics: z.string().optional(),
    bannedWords: z.string().optional(),
    recommendedWords: z.string().optional(),
    extraInstructions: z.string().optional(),
    model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).default("gpt-4o-mini"),
    // STAR_REDIRECT
    positiveUrl: z.string().url().optional().or(z.literal("")),
    negativeUrl: z.string().url().optional().or(z.literal("")),
    // Acepta placeId raw O una URL completa de la que extraemos el id.
    placeId: z.string().optional()
  })
  .refine(
    (d) => {
      if (d.mode === "AI_GENERATOR") {
        return !!d.destinationUrl && !!d.topics && d.topics.trim().length > 0;
      }
      return true;
    },
    { message: "Modo AI_GENERATOR requiere destinationUrl y topics" }
  )
  .refine(
    (d) => {
      if (d.mode === "STAR_REDIRECT") {
        // En STAR_REDIRECT exigimos negativeUrl SIEMPRE (el form
        // interno para 1-3★ es obligatorio: no queremos perder
        // ese feedback). positiveUrl puede venir vacía si pasan
        // placeId — la calculamos.
        return !!d.negativeUrl;
      }
      return true;
    },
    { message: "Modo STAR_REDIRECT requiere negativeUrl (página interna para 1-3★)" }
  );

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.reviewClient.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { opinions: true } } }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = reviewClientCreate.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.reviewClient.findUnique({
    where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: parsed.data.slug } }
  });
  if (existing) throw new ApiError(409, "slug_taken", "Ya existe un cliente con ese slug");

  // Normalizar placeId — el user puede pegar la URL completa de
  // whitespark/google/maps y le extraemos el ID. Si solo viene la
  // positiveUrl la respetamos tal cual.
  let placeId = parsed.data.placeId?.trim() || null;
  if (placeId) placeId = extractPlaceId(placeId) ?? placeId;

  // Si en STAR_REDIRECT no llegó positiveUrl pero sí placeId, la
  // calculamos. Si tampoco hay placeId, error (necesitamos algo a
  // dónde mandar al user satisfecho).
  let positiveUrl = parsed.data.positiveUrl?.trim() || null;
  if (parsed.data.mode === "STAR_REDIRECT") {
    if (!positiveUrl && placeId) {
      positiveUrl = buildGmbReviewUrl(placeId);
    }
    if (!positiveUrl) {
      throw new ApiError(
        400,
        "missing_positive_url",
        "Modo STAR_REDIRECT: pega positiveUrl o un placeId de Google."
      );
    }
  }

  const created = await prisma.reviewClient.create({
    data: {
      workspaceId: api.workspaceId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      webUrl: parsed.data.webUrl || null,
      mode: parsed.data.mode,
      // Para registros AI_GENERATOR mantenemos los campos obligatorios
      // como antes. Para STAR_REDIRECT, destinationUrl se duplica desde
      // positiveUrl para no romper el constraint NOT NULL del schema.
      destinationUrl:
        parsed.data.mode === "AI_GENERATOR"
          ? parsed.data.destinationUrl!
          : positiveUrl!,
      topics: parsed.data.topics ?? "",
      bannedWords: parsed.data.bannedWords || null,
      recommendedWords: parsed.data.recommendedWords || null,
      extraInstructions: parsed.data.extraInstructions || null,
      model: parsed.data.model,
      positiveUrl,
      negativeUrl: parsed.data.negativeUrl || null,
      placeId
    }
  });
  return NextResponse.json(created, { status: 201 });
});
