import { z } from "zod";
import { forbidden, isSameOrigin, requireOperator, unauthorized } from "@/lib/auth";
import { listPhoneConnectionsForOperator, operatorRegisterPhoneInfra } from "@/lib/vapi/phone-connection";
import { VapiApiError } from "@/lib/vapi/client";
import { operatorRegisterPhoneSchema } from "@/lib/vapi/schemas";

export const dynamic = "force-dynamic";

// Rutas del OPERADOR de Negocio Vivo (rol global, fail-closed vía
// NV_OPERATOR_EMAILS). Cruzan workspaces a propósito: sirven para asignar la
// infraestructura de teléfono que Negocio Vivo crea a mano para cada negocio.

function authError(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  return null;
}

export async function GET() {
  try {
    await requireOperator();
    return Response.json({ connections: await listPhoneConnectionsForOperator() });
  } catch (error) {
    return authError(error) || Response.json({ error: "No se pudo cargar la lista" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    await requireOperator();
    const input = operatorRegisterPhoneSchema.parse(await request.json());
    const connection = await operatorRegisterPhoneInfra(input);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    if (error instanceof z.ZodError) return Response.json({ error: "Revisa los datos introducidos", details: error.flatten() }, { status: 400 });
    if (error instanceof VapiApiError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if ((error as any)?.code === "P2002") return Response.json({ error: "Ese número de Vapi ya está asignado a otro negocio" }, { status: 409 });
    return Response.json({ error: "No se pudo registrar la infraestructura" }, { status: 500 });
  }
}
