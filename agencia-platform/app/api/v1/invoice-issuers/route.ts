import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { invoiceIssuerSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const items = await prisma.invoiceIssuer.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  const parsed = invoiceIssuerSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const count = await prisma.invoiceIssuer.count({
    where: { workspaceId: api.workspaceId, deletedAt: null }
  });
  const makeDefault = parsed.data.isDefault || count === 0;
  if (makeDefault) {
    await prisma.invoiceIssuer.updateMany({
      where: { workspaceId: api.workspaceId },
      data: { isDefault: false }
    });
  }
  const issuer = await prisma.invoiceIssuer.create({
    data: { ...parsed.data, isDefault: makeDefault, workspaceId: api.workspaceId }
  });
  return NextResponse.json(issuer, { status: 201 });
});
