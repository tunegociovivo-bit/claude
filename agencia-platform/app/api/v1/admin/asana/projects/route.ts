import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { AsanaClient } from "@/lib/asana/client";

export const POST = withApi({ scope: "admin" }, async (req) => {
  const body = await req.json().catch(() => null);
  if (!body?.token || !body?.workspaceGid) {
    throw new ApiError(400, "validation_error", "Faltan token o workspaceGid");
  }
  const client = new AsanaClient(body.token);
  const items: { gid: string; name: string }[] = [];
  try {
    for await (const p of client.workspaceProjects(body.workspaceGid)) {
      items.push({ gid: p.gid, name: p.name });
      if (items.length >= 200) break;
    }
    return NextResponse.json({ items });
  } catch (e: any) {
    throw new ApiError(502, "asana_error", e?.message ?? "Error al listar proyectos");
  }
});
