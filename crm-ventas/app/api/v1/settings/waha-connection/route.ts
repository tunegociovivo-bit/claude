import {
  forbidden,
  isSameOrigin,
  requireWorkspaceAdmin,
  unauthorized,
} from "@/lib/auth";
import { WahaUrlNotAllowedError } from "@/lib/waha";
import {
  ensureSessionStarted,
  getConnectionState,
  unlinkSession,
  WahaSelfServiceError,
} from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  if (error instanceof WahaUrlNotAllowedError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof WahaSelfServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: "No se pudo completar la operación con WAHA" },
    { status: 502 }
  );
}

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAdmin();
    return Response.json({ connection: await getConnectionState(workspaceId) });
  } catch (error) {
    return errorResponse(error);
  }
}

// Crear/arrancar la sesión del workspace (y renovar el QR si ya existía).
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    return Response.json({ connection: await ensureSessionStarted(workspaceId) });
  } catch (error) {
    return errorResponse(error);
  }
}

// Desvincular (logout) la sesión del workspace. Fail closed en la librería.
export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    await unlinkSession(workspaceId);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
