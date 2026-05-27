import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildGmbReviewUrl, extractPlaceId } from "@/lib/reviews/gmb-link";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  webUrl: z.string().url().optional().or(z.literal("")),
  mode: z.enum(["AI_GENERATOR", "STAR_REDIRECT"]).optional(),
  destinationUrl: z.string().url().optional().or(z.literal("")),
  topics: z.string().optional(),
  bannedWords: z.string().optional(),
  recommendedWords: z.string().optional(),
  extraInstructions: z.string().optional(),
  model: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).optional(),
  positiveUrl: z.string().url().optional().or(z.literal("")),
  negativeUrl: z.string().url().optional().or(z.literal("")),
  placeId: z.string().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Construimos update parcial — solo seteamos los campos que llegan
  // para no pisar valores existentes con undefined.
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.webUrl !== undefined) data.webUrl = parsed.data.webUrl || null;
  if (parsed.data.mode !== undefined) data.mode = parsed.data.mode;
  if (parsed.data.destinationUrl !== undefined && parsed.data.destinationUrl !== "") {
    data.destinationUrl = parsed.data.destinationUrl;
  }
  if (parsed.data.topics !== undefined) data.topics = parsed.data.topics;
  if (parsed.data.bannedWords !== undefined) data.bannedWords = parsed.data.bannedWords || null;
  if (parsed.data.recommendedWords !== undefined) data.recommendedWords = parsed.data.recommendedWords || null;
  if (parsed.data.extraInstructions !== undefined) data.extraInstructions = parsed.data.extraInstructions || null;
  if (parsed.data.model !== undefined) data.model = parsed.data.model;
  if (parsed.data.negativeUrl !== undefined) data.negativeUrl = parsed.data.negativeUrl || null;

  // placeId: extraer ID si el user pegó la URL completa.
  let placeId: string | null | undefined = undefined;
  if (parsed.data.placeId !== undefined) {
    const raw = parsed.data.placeId.trim();
    placeId = raw ? extractPlaceId(raw) ?? raw : null;
    data.placeId = placeId;
  }

  // positiveUrl: explícita gana; si no pero hay nuevo placeId, la
  // calculamos.
  if (parsed.data.positiveUrl !== undefined && parsed.data.positiveUrl !== "") {
    data.positiveUrl = parsed.data.positiveUrl;
  } else if (placeId) {
    const auto = buildGmbReviewUrl(placeId);
    if (auto) data.positiveUrl = auto;
  } else if (parsed.data.positiveUrl === "") {
    data.positiveUrl = null;
  }

  const result = await prisma.reviewClient.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");

  return NextResponse.json(await prisma.reviewClient.findUnique({ where: { id: params.id } }));
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const result = await prisma.reviewClient.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json({ ok: true });
});
