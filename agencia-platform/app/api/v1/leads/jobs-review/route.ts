/**
 * Módulo Empleos — cola de revisión.
 *
 *  GET → lista los emails redactados que esperan aprobación manual (modo review).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { listPendingReview } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await listPendingReview(api.workspaceId);
  return NextResponse.json({ items });
});
