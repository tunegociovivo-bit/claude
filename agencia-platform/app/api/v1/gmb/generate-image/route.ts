/**
 * POST /api/v1/gmb/generate-image → genera una imagen con DALL·E 3
 * Body: { prompt }  Devuelve { url }
 * Nota: la URL de OpenAI caduca (~1h). El front debe usarla pronto o subirla a R2.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

const schema = z.object({ prompt: z.string().min(3).max(1000) });

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let apiKey: string;
  try {
    apiKey = await getOpenAiKeyForWorkspace(api.workspaceId);
  } catch (e: any) {
    throw new ApiError(400, "no_openai_key", String(e?.message ?? e));
  }

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model: "dall-e-3", prompt: parsed.data.prompt, n: 1, size: "1024x1024" })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new ApiError(502, "ai_error", `OpenAI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const url = data?.data?.[0]?.url ?? "";
  if (!url) throw new ApiError(502, "ai_error", "OpenAI no devolvió imagen");
  return NextResponse.json({ url });
});
