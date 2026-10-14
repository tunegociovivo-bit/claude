// Modo operador: un operador de Negocio Vivo entra en el CRM de un cliente sin
// usuario propio allí. La sesión (JWT de NextAuth) pasa a apuntar al workspace
// del cliente y guarda el de origen para volver. La autorización real se
// revalida en BD en cada petición (lib/auth.ts → resolveSessionMember): el
// token por sí solo nunca da acceso.

export type SessionToken = Record<string, unknown>;

export function isActingToken(token: SessionToken | null | undefined): boolean {
  return Boolean(token && token.operatorActing === true);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// Entra en `workspaceId`. Si ya estaba dentro de otro cliente, conserva el
// workspace de origen original (no encadena). Entrar en el propio workspace de
// origen equivale a salir del modo operador.
export function enterWorkspaceToken(token: SessionToken, workspaceId: string): SessionToken {
  const homeWorkspaceId = isActingToken(token) ? str(token.homeWorkspaceId) : str(token.workspaceId);
  const homeRole = isActingToken(token) ? str(token.homeRole) : str(token.role);
  if (!homeWorkspaceId || workspaceId === homeWorkspaceId) return leaveWorkspaceToken(token);
  return {
    ...token,
    workspaceId,
    role: "ADMIN",
    operatorActing: true,
    homeWorkspaceId,
    homeRole: homeRole ?? "ADMIN",
  };
}

// Vuelve al workspace propio del operador.
export function leaveWorkspaceToken(token: SessionToken): SessionToken {
  const { operatorActing: _acting, homeWorkspaceId, homeRole, ...rest } = token;
  if (!isActingToken(token)) return rest;
  return {
    ...rest,
    workspaceId: str(homeWorkspaceId) ?? rest.workspaceId,
    role: str(homeRole) ?? rest.role,
  };
}

export type OperatorAccessEntry = { email: string; at: string; action: "entrar" };

// Registro de accesos de operador guardado en los ajustes del cliente (los 20
// últimos), para saber quién entró y cuándo.
export function appendOperatorAccess(settings: Record<string, any>, email: string, now = new Date()) {
  const previous: OperatorAccessEntry[] = Array.isArray(settings.operatorAccess) ? settings.operatorAccess : [];
  settings.operatorAccess = [{ email, at: now.toISOString(), action: "entrar" as const }, ...previous]
    .filter((entry) => entry && typeof entry.email === "string" && typeof entry.at === "string")
    .slice(0, 20);
}
