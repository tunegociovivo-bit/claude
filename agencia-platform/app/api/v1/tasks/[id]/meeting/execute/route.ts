/**
 * POST /api/v1/tasks/[id]/meeting/execute
 *
 * Materializa las acciones que la IA propuso tras una reunión. El
 * usuario marca cuáles quiere ejecutar y este endpoint las crea en
 * el Hub. Cada acción tiene un `tool` que decide el destino:
 *
 *   - subtask        → prisma.task.create con parentId
 *   - email          → subtarea con prefijo "✉️ Email:" + cuerpo en
 *                       description (NO se envía email real — el
 *                       responsable lo manda manualmente). Más
 *                       adelante se puede cablear a Resend con
 *                       confirmación previa.
 *   - calendar_event → prisma.calendarEvent.create si hay fecha
 *                       interpretable; si no, subtarea con prefijo
 *                       "📅 Programar:".
 *   - document       → prisma.document.create con título sugerido.
 *
 * Body: { items: { title, assignee?, due?, tool, tool_details? }[] }
 * Devuelve: { created: { subtasks, emails, events, documents }[] }
 *
 * NO ejecuta nada de forma irreversible: el email es un draft de
 * subtarea, el evento queda en calendario interno, el documento
 * empieza como esqueleto. El usuario puede deshacer todo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  title: z.string().min(1).max(500),
  assignee: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  tool: z.enum(["subtask", "email", "calendar_event", "document"]),
  tool_details: z.string().nullable().optional()
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(50)
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const parent = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, status: true, projectId: true, clientId: true }
  });
  if (!parent) throw new ApiError(404, "not_found", "Tarea padre no encontrada");

  // Para mapear assignees por nombre (mismo flow que /subtasks/bulk).
  const members = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId: api.workspaceId } } },
    select: { id: true, name: true, email: true }
  });
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  function lookupAssignee(name?: string | null): string | null {
    if (!name) return null;
    const target = norm(name);
    const hit = members.find(
      (m) => norm(m.name ?? "") === target || norm(m.email).split("@")[0] === target
    );
    return hit?.id ?? null;
  }

  const created: { subtasks: any[]; emails: any[]; events: any[]; documents: any[] } = {
    subtasks: [],
    emails: [],
    events: [],
    documents: []
  };

  for (const it of parsed.data.items) {
    const assigneeId = lookupAssignee(it.assignee);
    const due = it.due && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? new Date(it.due) : null;

    if (it.tool === "subtask") {
      const sub = await prisma.task.create({
        data: {
          workspaceId: api.workspaceId,
          title: it.title,
          status: "TODO",
          parentId: parent.id,
          projectId: parent.projectId,
          clientId: parent.clientId,
          dueDate: due,
          ...(assigneeId ? { assignees: { create: [{ userId: assigneeId }] } } : {})
        } as any
      });
      created.subtasks.push(sub);
      continue;
    }

    if (it.tool === "email") {
      // Como subtarea con prefijo claro + el detalle como descripción.
      // El responsable enviará el email manualmente (no asumimos
      // que el email del destinatario esté ya en el Hub).
      const sub = await prisma.task.create({
        data: {
          workspaceId: api.workspaceId,
          title: `✉️ ${it.title}`,
          description: it.tool_details ?? "Email propuesto por la IA tras la reunión.",
          status: "TODO",
          parentId: parent.id,
          projectId: parent.projectId,
          clientId: parent.clientId,
          dueDate: due,
          ...(assigneeId ? { assignees: { create: [{ userId: assigneeId }] } } : {})
        } as any
      });
      created.emails.push(sub);
      continue;
    }

    if (it.tool === "calendar_event") {
      // Si tenemos due (interpretado como fecha), lo creamos como
      // evento del calendario. Si no, cae a subtarea.
      if (due) {
        const ev = await prisma.calendarEvent.create({
          data: {
            workspaceId: api.workspaceId,
            clientId: parent.clientId ?? null,
            title: it.title,
            description: it.tool_details ?? "Programado tras reunión por IA",
            startAt: due,
            allDay: true,
            type: "MEETING"
          }
        });
        created.events.push(ev);
      } else {
        const sub = await prisma.task.create({
          data: {
            workspaceId: api.workspaceId,
            title: `📅 Programar: ${it.title}`,
            description: it.tool_details ?? null,
            status: "TODO",
            parentId: parent.id,
            projectId: parent.projectId,
            clientId: parent.clientId,
            ...(assigneeId ? { assignees: { create: [{ userId: assigneeId }] } } : {})
          } as any
        });
        created.events.push(sub);
      }
      continue;
    }

    if (it.tool === "document") {
      const docTitle = (it.tool_details && it.tool_details.length < 80 ? it.tool_details : it.title).slice(
        0,
        180
      );
      const doc = await prisma.document.create({
        data: {
          workspaceId: api.workspaceId,
          title: docTitle,
          authorId: api.userId,
          // Contenido inicial con un párrafo con el contexto que dio la
          // IA para que quien lo abra sepa de dónde sale.
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: it.tool_details ?? `Documento propuesto por IA tras la reunión "${parent.id}".`
                  }
                ]
              }
            ]
          } as any
        }
      });
      created.documents.push(doc);
      continue;
    }
  }

  return NextResponse.json({
    ok: true,
    counts: {
      subtasks: created.subtasks.length,
      emails: created.emails.length,
      events: created.events.length,
      documents: created.documents.length
    },
    created
  });
});
