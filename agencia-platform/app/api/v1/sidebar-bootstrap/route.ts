/**
 * GET /api/v1/sidebar-bootstrap  (FASE 2 · objetivo 5)
 *
 * Una sola respuesta con todo lo que el Sidebar necesitaba en 6 fetch no-store.
 * El Sidebar la usa como camino preferente y cae a los 6 endpoints si fallara.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getSidebarBootstrap } from "@/lib/sidebar/bootstrap";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const data = await getSidebarBootstrap(api.workspaceId, api.userId ?? null);
  return NextResponse.json(data);
});
