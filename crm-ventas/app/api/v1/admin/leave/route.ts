import { NextRequest, NextResponse } from "next/server";
import { isOperatorEmail, isSameOrigin } from "@/lib/auth";
import { isActingToken, leaveWorkspaceToken } from "@/lib/admin/acting-core";
import { readSessionToken, writeSessionToken } from "@/lib/admin/acting";

export const dynamic = "force-dynamic";

// Sale del CRM del cliente y vuelve al workspace propio del operador. No exige
// seguir siendo operador: volver a lo propio nunca da más acceso.
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const token = await readSessionToken(request);
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const redirect = isOperatorEmail(typeof token.email === "string" ? token.email : null) ? "/admin" : "/pipeline";
  const response = NextResponse.json({ ok: true, redirect });
  response.headers.set("Cache-Control", "no-store");
  if (isActingToken(token)) await writeSessionToken(request, response, leaveWorkspaceToken(token));
  return response;
}
