/**
 * Trabajos bancarios — listado paginado. Solo ADMIN.
 *  GET ?status=&page=&pageSize=
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { listJobs } from "@/lib/facturacion/sepa/agent";

export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "CLAIMED", "RUNNING", "NEEDS_USER", "PREPARED_PENDING_SIGNATURE", "FAILED", "CANCELLED"];

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !STATUSES.includes(status)) throw new ApiError(400, "bad_status", "Estado no válido");
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25") || 25;
  return NextResponse.json(await listJobs(api.workspaceId, { status, page, pageSize }));
});
