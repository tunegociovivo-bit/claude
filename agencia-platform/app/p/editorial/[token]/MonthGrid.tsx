"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";

type Decision = { id: string; decision: string; comment: string | null; createdAt: string };
type Post = {
  id: string;
  title: string;
  status: string;
  thumbnail: string | null;
  scheduledFor: string | null;
  decisions: Decision[];
};

/**
 * Grid mensual estilo calendario para el panel público de aprobación.
 * Cada celda corresponde a un día del mes; los posts programados ese
 * día aparecen como mini-thumbnails. Click sobre un thumb hace
 * scroll-into-view a la PostCard correspondiente abajo (donde están
 * los botones de aprobar/rechazar/comentar).
 *
 * Estado visual del thumb:
 *   - Aprobado (decisión approved más reciente) → borde verde
 *   - Rechazado → borde rojo
 *   - Sin decisión / en review → borde gris animado pulsante
 */
export default function MonthGrid({
  month,
  posts,
  accent
}: {
  month: string; // YYYY-MM
  posts: Post[];
  accent: string;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Lunes=0 en nuestro calendario
  const firstDow = (first.getUTCDay() + 6) % 7;

  // Agrupar posts por día
  const byDay: Record<number, Post[]> = {};
  for (const p of posts) {
    if (!p.scheduledFor) continue;
    const d = new Date(p.scheduledFor).getUTCDate();
    (byDay[d] ??= []).push(p);
  }

  function scrollToPost(id: string) {
    const el = document.getElementById(`post-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-offset-2");
      el.style.setProperty("--tw-ring-color", accent);
      setTimeout(() => el.classList.remove("ring-2", "ring-offset-2"), 1800);
    }
  }

  function decisionOf(p: Post): "approved" | "rejected" | "pending" {
    const last = p.decisions[p.decisions.length - 1];
    if (last?.decision === "approved") return "approved";
    if (last?.decision === "rejected") return "rejected";
    return "pending";
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isCurrentMonth =
    today.getUTCFullYear() === y && today.getUTCMonth() === m - 1;
  const todayDate = isCurrentMonth ? today.getUTCDate() : -1;

  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => (
          <div
            key={i}
            className={
              "min-h-[88px] rounded-lg border p-1 " +
              (d === null
                ? "bg-slate-50 border-slate-100"
                : d === todayDate
                  ? "bg-amber-50/50 border-amber-200"
                  : "bg-white border-slate-200")
            }
          >
            {d !== null && (
              <>
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <span
                    className={
                      "text-[11px] font-medium " +
                      (d === todayDate ? "text-amber-700" : "text-slate-500")
                    }
                  >
                    {d}
                  </span>
                  {(byDay[d]?.length ?? 0) > 0 && (
                    <span className="text-[9px] text-slate-400">
                      {byDay[d].length}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {(byDay[d] ?? []).slice(0, 4).map((p) => {
                    const dec = decisionOf(p);
                    return (
                      <button
                        key={p.id}
                        onClick={() => scrollToPost(p.id)}
                        title={p.title}
                        className={
                          "relative h-7 w-7 rounded-md overflow-hidden border " +
                          (dec === "approved"
                            ? "border-emerald-400"
                            : dec === "rejected"
                              ? "border-rose-400"
                              : "border-amber-300 animate-pulse")
                        }
                      >
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className="h-full w-full grid place-items-center text-[8px] text-slate-500"
                            style={{ backgroundColor: accent + "22" }}
                          >
                            ?
                          </div>
                        )}
                        <span
                          className={
                            "absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full grid place-items-center text-white text-[8px] "
                          }
                        >
                          {dec === "approved" && (
                            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600 fill-white" />
                          )}
                          {dec === "rejected" && (
                            <XCircle className="h-2.5 w-2.5 text-rose-600 fill-white" />
                          )}
                          {dec === "pending" && (
                            <Clock className="h-2.5 w-2.5 text-amber-600 fill-white" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {(byDay[d]?.length ?? 0) > 4 && (
                    <span className="h-7 w-7 rounded-md border border-slate-200 grid place-items-center text-[9px] text-slate-500">
                      +{byDay[d].length - 4}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2 text-center">
        Pulsa cualquier thumbnail para saltar a esa publicación.
        <span className="inline-block ml-2 px-1.5 rounded-full bg-emerald-100 text-emerald-700">aprobada</span>
        <span className="inline-block ml-1 px-1.5 rounded-full bg-rose-100 text-rose-700">rechazada</span>
        <span className="inline-block ml-1 px-1.5 rounded-full bg-amber-100 text-amber-700">pendiente</span>
      </p>
    </div>
  );
}
