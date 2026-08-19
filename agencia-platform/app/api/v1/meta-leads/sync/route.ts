import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { syncMetaLeadsForAccount } from "@/lib/meta/lead-sync";

const schema = z.object({ adAccountId: z.string().regex(/^act_\d+$/), accountName: z.string().min(1).max(200), connectionId: z.string().min(1).max(100) });
export const POST = withApi({}, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const input = parsed.data;
  await prisma.metaClientProfile.upsert({
    where: { workspaceId_adAccountId: { workspaceId: api.workspaceId, adAccountId: input.adAccountId } },
    create: { workspaceId: api.workspaceId, adAccountId: input.adAccountId, displayName: input.accountName, metaConnectionId: input.connectionId },
    update: { metaConnectionId: input.connectionId }
  });
  return NextResponse.json(await syncMetaLeadsForAccount({ workspaceId: api.workspaceId, adAccountId: input.adAccountId, connectionId: input.connectionId }));
});
