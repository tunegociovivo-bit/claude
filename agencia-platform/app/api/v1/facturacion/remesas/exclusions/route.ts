import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";

const schema = z.object({ number: z.string().trim().min(1).max(64), excluded: z.boolean() });

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const numbers = ((workspace?.settings as any)?.facturacion?.sepaExcludedInvoiceNumbers ?? []) as string[];
  return NextResponse.json({ numbers });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: parsed.error.message } }, { status: 400 });
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = structuredClone((workspace?.settings as any) ?? {});
  settings.facturacion ??= {};
  const current = new Set<string>((settings.facturacion.sepaExcludedInvoiceNumbers ?? []).map((n: string) => n.trim().toUpperCase()));
  const number = parsed.data.number.toUpperCase();
  if (parsed.data.excluded) current.add(number); else current.delete(number);
  settings.facturacion.sepaExcludedInvoiceNumbers = [...current].sort();
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, numbers: settings.facturacion.sepaExcludedInvoiceNumbers });
});
