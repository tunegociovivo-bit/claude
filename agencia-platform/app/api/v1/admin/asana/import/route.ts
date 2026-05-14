import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { startAsanaImport } from "@/lib/asana/importer";

const schema = z.object({
  token: z.string().min(10),
  asanaWorkspaceGid: z.string().min(1),
  projectGids: z.array(z.string()).optional()
});

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Guardamos token en AsanaConnection si hay user; si es API key sin user, lo pasamos directo
  if (api.userId) {
    await prisma.asanaConnection.upsert({
      where: { id: `${api.userId}` }, // simple key: 1 connection por user
      update: { accessToken: parsed.data.token },
      create: { id: `${api.userId}`, userId: api.userId, accessToken: parsed.data.token }
    });
  }

  const jobId = await startAsanaImport({
    workspaceId: api.workspaceId,
    asanaWorkspaceGid: parsed.data.asanaWorkspaceGid,
    token: parsed.data.token,
    projectGids: parsed.data.projectGids
  });

  return NextResponse.json({ jobId, status: "started" }, { status: 202 });
});
