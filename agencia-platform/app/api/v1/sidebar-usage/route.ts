/**
 * Consumo de IA por proyecto y por plataforma en los últimos 7 días.
 * Pensado para mostrar barras visuales en el sidebar.
 *
 * Devuelve { weekStart, projects: [{id, micros}], platforms: [{key, micros}], maxMicros }.
 * maxMicros es el máximo entre todos los items, para escalar barras relativas.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

// Mapeo de features (lib/ai/usage.ts) a platform keys
const FEATURE_TO_PLATFORM: Record<string, string> = {
  "reviews_generate": "reviews",
  "voice_transcribe": "voice_reviews",
  "voice_draft": "voice_reviews",
  "editorial_generate_month": "nv_dashboard",
  "leads_opener": "nv_leads",
  "redactor": "redactor_ia"
};

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const rows = await prisma.aiUsage.findMany({
    where: { workspaceId: api.workspaceId, createdAt: { gte: since } },
    select: { projectId: true, costMicros: true, feature: true }
  });

  const byProject = new Map<string, number>();
  const byPlatform = new Map<string, number>();

  for (const r of rows) {
    if (r.projectId) {
      byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.costMicros);
    }
    const platformKey = FEATURE_TO_PLATFORM[r.feature];
    if (platformKey) {
      byPlatform.set(platformKey, (byPlatform.get(platformKey) ?? 0) + r.costMicros);
    }
  }

  const projects = Array.from(byProject.entries()).map(([id, micros]) => ({ id, micros }));
  const platforms = Array.from(byPlatform.entries()).map(([key, micros]) => ({ key, micros }));

  const allValues = [...projects.map((p) => p.micros), ...platforms.map((p) => p.micros)];
  const maxMicros = allValues.length > 0 ? Math.max(...allValues) : 0;

  return NextResponse.json({
    weekStart: since.toISOString(),
    projects,
    platforms,
    maxMicros
  });
});
