/**
 * Remesas SEPA — listado (paginado). Solo ADMIN.
 *  GET ?status=&page=&pageSize=
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { listRequests } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

const STATUSES = ["PENDING_APPROVAL", "APPROVED", "PREPARING", "PENDING_SIGNATURE", "SIGNED", "REJECTED", "EXPIRED", "FAILED"];

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !STATUSES.includes(status)) throw new ApiError(400, "bad_status", "Estado no válido");
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25") || 25;
  const res = await listRequests(api.workspaceId, { status, page, pageSize });
  return NextResponse.json(res);
});
