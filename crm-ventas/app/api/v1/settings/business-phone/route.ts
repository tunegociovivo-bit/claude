import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions, forbidden, isSameOrigin, requireWorkspaceAdmin, requireWorkspaceId, unauthorized } from "@/lib/auth";
import { getVapiPhoneConnection, saveBusinessPhone } from "@/lib/vapi/phone-connection";
import { VapiApiError } from "@/lib/vapi/client";
import { businessPhoneSchema } from "@/lib/vapi/schemas";

export const dynamic = "force-dynamic";

function authError(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  return null;
}

export async function GET() {
  try {
    const workspaceId = await requireWorkspaceId();
    return Response.json({ connection: await getVapiPhoneConnection(workspaceId) });
  } catch (error) {
    return authError(error) || Response.json({ error: "No se pudo cargar el teléfono" }, { status: 500 });
  }
}

// El cliente guarda su móvil público (sin credenciales de ningún proveedor).
// El aviso operativo a Negocio Vivo se dispara solo si el número cambió o si
// quedó un aviso pendiente; un fallo de email nunca pierde el guardado.
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    const session = await getServerSession(authOptions);
    const requestedBy = session?.user?.email ?? null;
    const input = businessPhoneSchema.parse(await request.json());
    const connection = await saveBusinessPhone(workspaceId, input, requestedBy);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    if (error instanceof z.ZodError) return Response.json({ error: "Revisa el número: usa formato internacional, p. ej. +34611222333", details: error.flatten() }, { status: 400 });
    if (error instanceof VapiApiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "No se pudo guardar el teléfono" }, { status: 500 });
  }
}
