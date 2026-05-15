/**
 * Endpoint interno disparado por un cron (GitHub Actions) para generar
 * notificaciones de "tu tarea vence pronto".
 *
 * Protegido por bearer token: header `Authorization: Bearer <INTERNAL_CRON_TOKEN>`.
 * Configura la env var en Railway y el mismo valor como secret en GitHub.
 *
 * Lógica:
 *   - Busca tareas con dueDate entre ahora y +24h, status != DONE/CANCELLED.
 *   - Para cada asignado, crea una Notification si no existe ya una de tipo
 *     "deadline" para esa tarea (idempotencia via body).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "cron_disabled", message: "INTERNAL_CRON_TOKEN no configurado" } },
      { status: 503 }
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Token inválido" } }, { status: 401 });
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasksDue = await prisma.task.findMany({
    where: {
      dueDate: { gte: now, lte: tomorrow },
      status: { notIn: ["DONE", "CANCELLED"] }
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignees: { select: { userId: true } }
    }
  });

  let created = 0;
  for (const task of tasksDue) {
    const dueStr = task.dueDate
      ? task.dueDate.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    const body = `Tu tarea "${task.title}" vence el ${dueStr}`;
    for (const a of task.assignees) {
      // Idempotencia: si ya existe una notificación con el mismo body para
      // este usuario y task no creamos otra.
      const existing = await prisma.notification.findFirst({
        where: { userId: a.userId, type: "deadline", body }
      });
      if (existing) continue;
      const link = `/tareas?task=${task.id}`;
      await prisma.notification.create({
        data: {
          userId: a.userId,
          type: "deadline",
          body,
          link
        }
      });
      // push best-effort, no bloquea el cron
      sendPushToUser(a.userId, {
        title: "Vence pronto",
        body,
        link,
        tag: `deadline-${task.id}`
      }).catch((e) => console.warn("[push] deadline fallo:", e?.message ?? e));
      created++;
    }
  }

  return NextResponse.json({
    ok: true,
    tasksChecked: tasksDue.length,
    notificationsCreated: created
  });
}
