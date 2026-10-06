import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { publicSeoBlogSettings, saveSeoBlogSettings, SettingsValidationError } from "@/lib/seo-blog/settings";
import { num, parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

export const GET = withApi({ module: "seo" }, async (_req, { api }) => {
  return NextResponse.json({ ...(await publicSeoBlogSettings(api.workspaceId)), isAdmin: api.role === "ADMIN" });
});

const Body = z.object({
  seoMinScore: z.union([num, z.null()]).optional(),
  ideasPerRun: z.union([num, z.null()]).optional(),
  notifyEmail: z.union([z.string().max(200), z.null()]).optional()
});

export const PATCH = withApi({ module: "seo", admin: true }, async (req, { api }) => {
  const body = await parseBody(req, Body);
  try {
    return NextResponse.json({ ...(await saveSeoBlogSettings(api.workspaceId, body)), isAdmin: true });
  } catch (e) {
    if (e instanceof SettingsValidationError) throw new ApiError(400, "validation_error", e.message);
    throw e;
  }
});
