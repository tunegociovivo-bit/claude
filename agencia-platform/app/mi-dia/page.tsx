import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import { CheckCircle2, Clock, MessageSquare, CalendarDays, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * "Mi día" — la página que abres por la mañana. Junta en un solo
 * lugar lo que hoy te importa:
 *   - Tareas vencen hoy + mañana asignadas a ti
 *   - Eventos del calendario de hoy
 *   - Notificaciones sin leer (menciones, asignaciones)
 *   - Tareas en review esperándote (assigned + status REVIEW)
 *
 * Pensada para reducir los 3 clicks que hoy hay que dar para ver
 * cada cosa por separado.
 */
export default async function MiDiaPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(today);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 2);
  const dayEnd = new Date(today);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [dueSoon, inReview, eventsToday, notifs, overdue] = await Promise.all([
    // Tareas que vencen hoy o mañana asignadas a mí (no completadas)
    prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: "DONE" },
        assignees: { some: { userId } },
        dueDate: { gte: today, lt: tomorrowEnd }
      },
      orderBy: { dueDate: "asc" },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true, color: true } }
      },
      take: 30
    }),
    // En review asignadas a mí
    prisma.task.findMany({
      where: {
        workspaceId,
        status: "REVIEW",
        assignees: { some: { userId } }
      },
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true, color: true } }
      },
      take: 20
    }),
    // Eventos del día
    prisma.calendarEvent.findMany({
      where: {
        workspaceId,
        startAt: { gte: today, lt: dayEnd }
      },
      orderBy: { startAt: "asc" },
      take: 20
    }),
    // Notificaciones sin leer
    prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    // Vencidas (urgente)
    prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: "DONE" },
        assignees: { some: { userId } },
        dueDate: { lt: today }
      },
      orderBy: { dueDate: "asc" },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true, color: true } }
      },
      take: 20
    })
  ]);

  const greet = greeting(new Date());

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={`${greet}, ${(session?.user as any)?.name?.split(" ")[0] ?? ""}`}
        description={`Tu día de hoy en una sola vista. ${
          overdue.length > 0
            ? `Tienes ${overdue.length} tarea${overdue.length === 1 ? "" : "s"} vencida${overdue.length === 1 ? "" : "s"} esperando.`
            : "Sin vencidas — vas al día."
        }`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {overdue.length > 0 && (
          <Section
            title="Vencidas"
            icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
            tone="danger"
            empty="Sin vencidas — bien jugado."
          >
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t as any} highlight />
            ))}
          </Section>
        )}

        <Section
          title="Vencen hoy y mañana"
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          empty="Sin vencimientos próximos."
        >
          {dueSoon.map((t) => (
            <TaskRow key={t.id} task={t as any} />
          ))}
        </Section>

        <Section
          title="En review esperándote"
          icon={<CheckCircle2 className="h-4 w-4 text-sky-600" />}
          empty="Nada pendiente de revisar."
        >
          {inReview.map((t) => (
            <TaskRow key={t.id} task={t as any} />
          ))}
        </Section>

        <Section
          title="Eventos de hoy"
          icon={<CalendarDays className="h-4 w-4 text-emerald-600" />}
          empty="Sin eventos en la agenda de hoy."
        >
          {eventsToday.map((e) => (
            <Link
              key={e.id}
              href="/calendario"
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50"
            >
              <span className="text-xs text-slate-500 w-12">
                {e.allDay
                  ? "Todo el día"
                  : new Date(e.startAt).toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
              </span>
              <span className="flex-1 text-sm truncate">{e.title}</span>
            </Link>
          ))}
        </Section>

        <Section
          title="Notificaciones sin leer"
          icon={<MessageSquare className="h-4 w-4 text-brand-600" />}
          empty="Bandeja al día."
        >
          {notifs.map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "#"}
              className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-slate-50"
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-400 w-16 mt-0.5 shrink-0">
                {n.type}
              </span>
              <span className="flex-1 text-sm">{n.body}</span>
            </Link>
          ))}
        </Section>
      </div>
    </div>
  );
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "Buenas noches";
  if (h < 14) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

function Section({
  title,
  icon,
  children,
  empty,
  tone
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  empty: string;
  tone?: "danger";
}) {
  const arr = Array.isArray(children) ? children : [children];
  const isEmpty = arr.filter(Boolean).length === 0;
  return (
    <div
      className={
        "bg-white rounded-xl border p-4 " +
        (tone === "danger" ? "border-rose-200 bg-rose-50/40" : "")
      }
    >
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
        {icon}
        {title}
      </div>
      {isEmpty ? (
        <p className="text-xs text-slate-500 italic px-1 py-2">{empty}</p>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  highlight
}: {
  task: {
    id: string;
    title: string;
    dueDate: Date | null;
    client?: { name: string } | null;
    project?: { name: string; color: string | null } | null;
  };
  highlight?: boolean;
}) {
  return (
    <Link
      href={`/tareas?task=${task.id}`}
      className={
        "flex items-center gap-3 px-3 py-2 rounded-lg " +
        (highlight ? "hover:bg-rose-100/60" : "hover:bg-slate-50")
      }
    >
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ background: task.project?.color ?? "#94a3b8" }}
      />
      <span className="flex-1 text-sm truncate">{task.title}</span>
      {task.client?.name && (
        <span className="text-[11px] text-slate-500 hidden sm:inline">{task.client.name}</span>
      )}
      {task.dueDate && (
        <span className={"text-[11px] " + (highlight ? "text-rose-600 font-medium" : "text-slate-500")}>
          {new Date(task.dueDate).toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "short"
          })}
        </span>
      )}
    </Link>
  );
}
