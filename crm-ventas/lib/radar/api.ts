import "server-only";
import { isOperatorEmail, resolveSessionMember, isSameOrigin } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";

export type RadarUser = { workspaceId: string; userId: string; role: string; email: string; isAdmin: boolean; isOperator: boolean };

export class RadarApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Usuario del workspace revalidado en BD y con el módulo «radar» activo. */
export async function requireRadarUser(): Promise<RadarUser> {
  const member = await resolveSessionMember();
  if (!member) throw new RadarApiError(401, "Inicia sesión para continuar");
  if (!(await isModuleEnabled(member.workspaceId, "radar"))) {
    throw new RadarApiError(403, "El Radar de subastas no está activo en tu cuenta. Pídeselo a Negocio Vivo.");
  }
  return {
    workspaceId: member.workspaceId,
    userId: member.userId,
    role: member.role,
    email: member.email,
    isAdmin: member.role === "ADMIN",
    isOperator: isOperatorEmail(member.email),
  };
}

/** Las credenciales de los portales solo las toca un administrador del negocio. */
export async function requireRadarAdmin(): Promise<RadarUser> {
  const user = await requireRadarUser();
  if (!user.isAdmin) throw new RadarApiError(403, "Solo un administrador del negocio puede cambiar esto");
  return user;
}

export function assertSameOrigin(req: Request): void {
  if (!isSameOrigin(req)) throw new RadarApiError(403, "Origen no permitido");
}

export function radarError(error: unknown) {
  if (error instanceof RadarApiError) return Response.json({ error: error.message }, { status: error.status });
  const message = (error as Error)?.message || "Error";
  console.error("[radar-api]", message);
  return Response.json({ error: "No se pudo completar la operación" }, { status: 500 });
}
