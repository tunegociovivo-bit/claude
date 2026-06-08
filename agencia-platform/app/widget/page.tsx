import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readKanbanColumns } from "@/lib/kanban";
import { RefreshCw, CalendarClock, ChevronRight } from "lucide-react";
import WidgetControls from "./WidgetControls";

export const dynamic = "force-dynamic";

/**
 * Widget "Próximas reuniones" — vista de una sola cosa, pensada para
 * añadir a la pantalla de inicio del móvil (PWA) y abrir de un toque.
 *
 * Muestra tus próximas tareas con fecha, agrupadas por día (Hoy /
 * Mañana / fecha). Se puede filtrar por proyecto y por columna del
 * kanban; la elección se recuerda en el navegador (localStorage) y
 * viaja en la URL, así el acceso directo abre siempre tu vista.
 *
 * Va sin chrome (sin sidebar) — ver NO_CHROME_PREFIXES en AppChrome:
 * "/widget" está en la lista para que se sienta como una app aparte.
 */

type SP = { project?: string; col?: string; scope?: string };

export default async function WidgetPage({
  searchParams
}: {
  searchParams: SP;
}) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login?from=/widget");

  const projectFilter = searchParams.project && searchParams.project !== "all" ? searchParams.project : null;
  const colFilter = searchParams.col && searchParams.col !== "all" ? searchParams.col : null;
  // scope: "me" (solo mías, por defecto) | "all" (todo el workspace)
  const scope = searchParams.scope === "all" ? "all" : "me";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [ws, projects, tasks] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true }
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        status: colFilter ? colFilter : { not: "DONE" },
        dueDate: { gte: today },
        ...(projectFilter ? { projectId: projectFilter } : {}),
        ...(scope === "me" ? { assignees: { some: { userId } } } : {})
      },
      orderBy: { dueDate: "asc" },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true, color: true } }
      },
      take: 14
    })
  ]);

  const columns = readKanbanColumns(ws?.settings).filter((c) => !c.isDone);
  const groups = groupByDay(tasks);
  const now = new Date();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-md mx-auto px-4 py-5 pb-10">
        {/* Cabecera */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-brand-600 text-white grid place-items-center shrink-0">
              <CalendarClock className="h-4 w-4" />
            </span>
            <h1 className="text-base font-semibold text-slate-900">Próximas reuniones</h1>
          </div>
          <Link
            href={buildHref(searchParams)}
            aria-label="Actualizar"
            className="h-8 w-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-200/60 active:scale-95 transition"
          >
            <RefreshCw className="h-4 w-4" />
          </Link>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {tasks.length === 0
            ? "Nada a la vista — vas al día."
            : `${tasks.length} pendiente${tasks.length === 1 ? "" : "s"} · actualizado ${now.toLocaleTimeString(
                "es-ES",
                { hour: "2-digit", minute: "2-digit" }
              )}`}
        </p>

        {/* Controles (proyecto / columna / alcance) */}
        <WidgetControls
          projects={projects}
          columns={columns}
          current={{ project: searchParams.project ?? "all", col: searchParams.col ?? "all", scope }}
        />

        {/* Lista */}
        <div className="mt-4 space-y-5">
          {groups.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
              <p className="text-sm text-slate-500">No hay tareas con fecha próxima.</p>
              <Link
                href="/tareas?new=1"
                className="inline-block mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Crear una tarea
              </Link>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2 px-1">
                {g.label}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {g.tasks.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tareas?task=${t.id}`}
                    className="flex items-center gap-3 px-3.5 py-3 active:bg-slate-50"
                  >
                    <span
                      className="h-9 w-1 rounded-full shrink-0"
                      style={{ background: t.project?.color ?? "#94a3b8" }}
                    />
                    <span className="w-12 shrink-0 text-right">
                      <span className={"block text-sm font-semibold " + (isOverdueSoon(t.dueDate) ? "text-rose-600" : "text-slate-900")}>
                        {t.dueAllDay ? "—" : timeOf(t.dueDate)}
                      </span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">{t.title}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {[t.project?.name, t.client?.name].filter(Boolean).join(" · ") || "Sin proyecto"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center">
          <Link href="/mi-dia" className="text-xs text-slate-400 hover:text-slate-600">
            Ver «Mi día» completo →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

type TaskLite = {
  id: string;
  title: string;
  dueDate: Date | null;
  dueAllDay: boolean;
  client?: { name: string } | null;
  project?: { name: string; color: string | null } | null;
};

function groupByDay(tasks: TaskLite[]): { key: string; label: string; tasks: TaskLite[] }[] {
  const map = new Map<string, { key: string; label: string; tasks: TaskLite[] }>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const d = new Date(t.dueDate);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, { key, label: dayLabel(d), tasks: [] });
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()];
}

function dayLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "short" });
}

function timeOf(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Marca en rojo lo que vence en la próxima hora (o ya pasó hoy). */
function isOverdueSoon(d: Date | null): boolean {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff < 60 * 60 * 1000;
}

function buildHref(sp: SP): string {
  const q = new URLSearchParams();
  if (sp.project && sp.project !== "all") q.set("project", sp.project);
  if (sp.col && sp.col !== "all") q.set("col", sp.col);
  if (sp.scope === "all") q.set("scope", "all");
  const s = q.toString();
  return s ? `/widget?${s}` : "/widget";
}
