import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientCreateSchema } from "@/lib/api/schemas";
import { callerIsAdmin, redactMrrList } from "@/lib/api/permissions";
import { indexEntity } from "@/lib/search/embeddings";
import { textForClient } from "@/lib/search/indexers";

export const GET = withApi({ scope: "clients:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  // Default 500 y cap 500. Las UIs (TopBar, Sidebar, EditorialClient,
  // ProyectosClient, redactor…) necesitan TODOS los clientes para
  // dropdowns. Antes el default 50 cortaba y se perdían los más
  // antiguos al haber muchos.
  const take = Math.min(Number(url.searchParams.get("limit") ?? 500), 500);
  const skip = Number(url.searchParams.get("offset") ?? 0);
  // Búsqueda por nombre en servidor. Imprescindible cuando hay más de
  // 500 clientes: el cap de 500 deja fuera a los más antiguos, así que
  // los dropdowns con buscador (p.ej. filtro del calendario editorial)
  // deben poder encontrarlos consultando la BD, no solo la lista cargada.
  const q = (url.searchParams.get("q") ?? "").trim();

  const where: any = { workspaceId: api.workspaceId, deletedAt: null };
  if (status) where.status = status;
  if (q) where.name = { contains: q, mode: "insensitive" };

  const [items, total, isAdmin] = await Promise.all([
    prisma.client.findMany({ where, take, skip, orderBy: { createdAt: "desc" } }),
    prisma.client.count({ where }),
    callerIsAdmin(api)
  ]);

  return NextResponse.json({ items: redactMrrList(items as any, isAdmin), total, limit: take, offset: skip });
});

export const POST = withApi({ scope: "clients:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Si el caller no es admin, ignoramos cualquier mrr que venga en el
  // payload para que un MEMBER no pueda saltarse el gate vía API.
  const isAdmin = await callerIsAdmin(api);
  const data = isAdmin ? parsed.data : { ...parsed.data, mrr: undefined as any };

  const client = await prisma.client.create({
    data: { ...data, workspaceId: api.workspaceId, since: new Date() }
  });
  void indexEntity({
    workspaceId: api.workspaceId,
    entityType: "CLIENT",
    entityId: client.id,
    text: textForClient(client as any)
  }).catch(() => {});
  return NextResponse.json(redactMrrList([client as any], isAdmin)[0], { status: 201 });
});
