import "server-only";
import { isOperatorEmail, resolveSessionMember } from "@/lib/auth";
import { WahaUrlNotAllowedError, WhatsappNotConfiguredError } from "@/lib/waha";
import { WahaSelfServiceError } from "@/lib/waha-connection";
import { OutboundError } from "@/lib/inbox/outbound";

export type InboxUser = {
  workspaceId: string;
  userId: string;
  role: string;
  email: string;
  isAdmin: boolean;
  isOperator: boolean;
};

// Usuario del workspace revalidado en BD (rol incluido) en cada petición.
export async function requireInboxUser(): Promise<InboxUser> {
  const member = await resolveSessionMember();
  if (!member) throw new Error("UNAUTHORIZED");
  return {
    workspaceId: member.workspaceId,
    userId: member.userId,
    role: member.role,
    email: member.email,
    isAdmin: member.role === "ADMIN",
    isOperator: isOperatorEmail(member.email),
  };
}

export async function requireInboxAdmin(): Promise<InboxUser> {
  const user = await requireInboxUser();
  if (!user.isAdmin) throw new Error("FORBIDDEN");
  return user;
}

export function inboxError(error: unknown) {
  const message = (error as Error)?.message;
  if (message === "UNAUTHORIZED") return Response.json({ error: "No autorizado" }, { status: 401 });
  if (message === "FORBIDDEN") {
    return Response.json({ error: "Solo un administrador puede realizar esta acción" }, { status: 403 });
  }
  if (error instanceof OutboundError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof WahaSelfServiceError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof WahaUrlNotAllowedError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof WhatsappNotConfiguredError) return Response.json({ error: error.message }, { status: 409 });
  console.error("[inbox-api]", message);
  return Response.json({ error: "No se pudo completar la operación" }, { status: 500 });
}
