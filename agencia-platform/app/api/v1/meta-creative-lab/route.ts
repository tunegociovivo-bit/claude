import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson } from "@/lib/ai/anthropic";
import type { Prisma } from "@prisma/client";

const schema = z.object({ adAccountId: z.string().regex(/^act_\d+$/), campaigns: z.array(z.object({ id: z.string(), name: z.string(), leads: z.number(), spend: z.number(), cpl: z.number().nullable(), ctr: z.number() })).max(30), commercial: z.record(z.string(), z.unknown()), brief: z.string().max(20000).optional() });
export const POST = withApi({ rate: "ai" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null)); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const result = await completeJson<{ patterns: string[]; experiments: Array<{ hypothesis: string; control: string; variant: string; metric: string; minimumRule: string }> }>({ workspaceId: api.workspaceId, feature: "meta_creative_lab", system: "Eres estratega creativo senior de Meta Ads. Diseña experimentos donde cambie una sola variable. No inventes aprendizajes si los datos sólo están a nivel campaña. Prioriza calidad y ventas frente a clics. Los conceptos deben ser específicos y utilizables para generar anuncios, respetando políticas publicitarias.", user: JSON.stringify(parsed.data), schema: { type: "object", properties: { patterns: { type: "array", items: { type: "string" }, maxItems: 6 }, experiments: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", properties: { hypothesis: { type: "string" }, control: { type: "string" }, variant: { type: "string" }, metric: { type: "string" }, minimumRule: { type: "string" } }, required: ["hypothesis", "control", "variant", "metric", "minimumRule"], additionalProperties: false } } }, required: ["patterns", "experiments"], additionalProperties: false }, maxTokens: 1800 });
  await prisma.metaClientProfile.updateMany({ where: { workspaceId: api.workspaceId, adAccountId: parsed.data.adAccountId }, data: { creativeMemory: { generatedAt: new Date().toISOString(), ...result } as Prisma.InputJsonValue } });
  return NextResponse.json(result);
});
