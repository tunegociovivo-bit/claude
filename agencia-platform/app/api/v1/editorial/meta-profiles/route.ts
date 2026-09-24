import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listEditorialMetaProfiles, upsertEditorialMetaProfile } from "@/lib/editorial/meta-publishing";
import { editorialGraphGet } from "@/lib/editorial/meta-publishing";
import { listWorkspaceMetaTokens } from "@/lib/meta/connection";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  clientId: z.string().min(1),
  metaConnectionId: z.string().optional().nullable(),
  label: z.string().min(1).max(120),
  facebookPageId: z.string().optional().nullable(),
  facebookPageName: z.string().optional().nullable(),
  instagramUserId: z.string().optional().nullable(),
  instagramName: z.string().optional().nullable(),
  active: z.boolean().optional()
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (url.searchParams.get("discover") === "1") {
    const accounts = [];
    const errors = [];
    for (const connection of await listWorkspaceMetaTokens(api.workspaceId)) {
      try {
        let after: string | undefined;
        do {
          const page: { data: Array<{ id: string; name: string; instagram_business_account?: { id: string; username?: string }; business?: { id: string; name: string } }>; paging?: { next?: string; cursors?: { after?: string } } } = await editorialGraphGet("me/accounts", connection.token, { fields: "id,name,instagram_business_account{id,username},business{id,name}", limit: "100", ...(after ? { after } : {}) });
          accounts.push(...page.data.map((item) => ({ ...item, metaConnectionId: connection.id, connectionName: connection.displayName })));
          after = page.paging?.next ? page.paging.cursors?.after : undefined;
        } while (after);
      } catch (error) { errors.push(error instanceof Error ? error.message : "No se pudieron consultar las cuentas."); }
    }
    return NextResponse.json({ accounts, errors });
  }
  const items = await listEditorialMetaProfiles(api.workspaceId, clientId);
  return NextResponse.json({ items });
});

export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new ApiError(400, "validation_error", "Selecciona un perfil.");
  await prisma.$transaction([
    prisma.editorialMetaProfile.updateMany({ where: { id, workspaceId: api.workspaceId }, data: { active: false } }),
    prisma.editorialPublication.updateMany({ where: { profileId: id, workspaceId: api.workspaceId, status: { in: ["PENDING", "SCHEDULED", "FAILED"] } }, data: { status: "CANCELLED", lastError: "Cuenta desconectada por el usuario." } })
  ]);
  return NextResponse.json({ ok: true });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const item = await upsertEditorialMetaProfile({ workspaceId: api.workspaceId, ...parsed.data });
    return NextResponse.json(item, { status: 201 });
  } catch (error: any) {
    throw new ApiError(400, "meta_profile_error", String(error?.message ?? error));
  }
});
