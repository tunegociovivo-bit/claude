import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startAsanaImport } from "@/lib/asana/importer";
import { saveAsanaToken } from "@/lib/asana/token";

const schema = z.object({
  token: z.string().min(10),
  asanaWorkspaceGid: z.string().min(1),
  projectGids: z.array(z.string()).optional()
});

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Guardamos el token cifrado en AsanaConnection si hay user. Si la
  // llamada viene de una API key sin user humano, se usa el token
  // del request directamente sin persistir.
  if (api.userId) {
    await saveAsanaToken({ userId: api.userId, token: parsed.data.token });
  }

  const jobId = await startAsanaImport({
    workspaceId: api.workspaceId,
    asanaWorkspaceGid: parsed.data.asanaWorkspaceGid,
    token: parsed.data.token,
    projectGids: parsed.data.projectGids
  });

  return NextResponse.json({ jobId, status: "started" }, { status: 202 });
});
