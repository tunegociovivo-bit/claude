import { z } from "zod";
import { forbidden, isSameOrigin, requireWorkspaceAdmin, requireWorkspaceId, unauthorized } from "@/lib/auth";
import { getVapiPhoneConnection, provisionVapiPhone, releaseFailedVapiPhoneAttempt, vapiSelfServiceEnabled } from "@/lib/vapi/phone-connection";
import { VapiApiError } from "@/lib/vapi/client";
import { provisionVapiPhoneSchema } from "@/lib/vapi/schemas";

export const dynamic = "force-dynamic";

function authError(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  return null;
}

export async function GET() {
  try {
    const workspaceId = await requireWorkspaceId();
    return Response.json({ enabled: vapiSelfServiceEnabled(), connection: await getVapiPhoneConnection(workspaceId) });
  } catch (error) {
    return authError(error) || Response.json({ error: "No se pudo cargar el teléfono" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    const operationKey = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const input = provisionVapiPhoneSchema.parse(await request.json());
    const connection = await provisionVapiPhone(workspaceId, input, operationKey);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    if (error instanceof z.ZodError) return Response.json({ error: "Revisa los datos introducidos", details: error.flatten() }, { status: 400 });
    if (error instanceof VapiApiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if ((error as any)?.code === "P2002") return Response.json({ error: "Ya existe una operación o número para este negocio" }, { status: 409 });
    return Response.json({ error: "No se pudo configurar el número" }, { status: 500 });
  }
}

// Libera un intento FAILED sin recursos externos para que el administrador
// pueda corregir los datos y volver a intentarlo. Nunca toca nada en Vapi.
export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    await releaseFailedVapiPhoneAttempt(workspaceId);
    return Response.json({ ok: true });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    if (error instanceof VapiApiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "No se pudo liberar el intento" }, { status: 500 });
  }
}
