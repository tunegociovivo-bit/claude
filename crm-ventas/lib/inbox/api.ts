import "server-only";
import { getServerSession } from "next-auth";
import { authOptions, isOperatorEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!workspaceId || !userId) throw new Error("UNAUTHORIZED");
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, workspace: { isBlocked: false } },
    select: { role: true, email: true },
  });
  if (!user) throw new Error("UNAUTHORIZED");
  return {
    workspaceId,
    userId,
    role: user.role,
    email: user.email,
    isAdmin: user.role === "ADMIN",
    isOperator: isOperatorEmail(user.email),
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
