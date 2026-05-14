import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { AsanaClient } from "@/lib/asana/client";

export const POST = withApi({ scope: "admin" }, async (req) => {
  const body = await req.json().catch(() => null);
  const token = body?.token;
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "validation_error", "Falta el campo token");
  }

  try {
    const me = await new AsanaClient(token).me();
    return NextResponse.json({
      user: { name: me.data.name, email: me.data.email },
      workspaces: me.data.workspaces
    });
  } catch (e: any) {
    throw new ApiError(401, "asana_auth_failed", e?.message ?? "Token no válido");
  }
});
