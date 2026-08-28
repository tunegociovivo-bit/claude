import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { permanentlyDeleteInvoice } from "@/lib/invoicing/permanent-delete";

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  try {
    await permanentlyDeleteInvoice(prisma, api.workspaceId, params.id);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (/no encontrada/i.test(message)) throw new ApiError(404, "not_found", message);
    if (/papelera/i.test(message)) throw new ApiError(409, "not_trashed", message);
    throw error;
  }
  return NextResponse.json({ ok: true, permanentlyDeleted: true });
});
