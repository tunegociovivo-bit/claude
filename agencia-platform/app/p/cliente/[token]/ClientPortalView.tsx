"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, FolderKanban, CheckCircle2, AlertCircle, ExternalLink, Loader2, FileCheck2, Clock, XCircle } from "lucide-react";
import ClientDeliverablesSection from "./ClientDeliverablesSection";

type PortalData = {
  workspace: { name: string; logoUrl: string | null };
  client: {
    id: string;
    name: string;
    brandColorPrimary: string | null;
    brandColorAccent: string | null;
    logoUrl: string | null;
  };
  month: string;
  expiresAt: string | null;
  projects: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    progress: number;
    updatedAt: string;
  }[];
  events: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    allDay: boolean;
    type: string;
  }[];
  editorial: {
    total: number;
    approved: number;
    review: number;
    rejected: number;
    other: number;
  };
  approvalUrl: string;
};

export default function ClientPortalView({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/portal/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error?.message ?? "No se pudo cargar");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen grid place-items-center text-rose-600">
        {error ?? "Link no válido."}
      </div>
    );
  }

  const accent = data.client.brandColorAccent ?? data.client.brandColorPrimary ?? "#0ea5e9";
  const monthLabel = new Date(data.month + "-01T00:00:00Z").toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header
        className="border-b bg-white"
        style={data.client.brandColorPrimary ? { borderTop: `4px solid ${data.client.brandColorPrimary}` } : undefined}
      >
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center gap-4">
          {data.client.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.client.logoUrl} alt={data.client.name} className="h-12 w-12 rounded-lg object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-slate-900">{data.client.name}</h1>
            <p className="text-sm text-slate-500">
              Portal de cliente · Vista de {monthLabel}
            </p>
          </div>
          <div className="text-xs text-slate-500 text-right">
            <div>Powered by</div>
            <div className="font-medium text-slate-700">{data.workspace.name}</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {data.editorial.review > 0 && (
          <Link
            href={data.approvalUrl}
            className="block bg-white rounded-xl border border-amber-200 p-5 hover:shadow-sm transition"
            style={{ background: `linear-gradient(90deg, ${accent}11, transparent)` }}
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <h2 className="font-semibold text-slate-900">
                  Tienes {data.editorial.review} publicacion{data.editorial.review === 1 ? "" : "es"} esperando tu visto bueno
                </h2>
                <p className="text-sm text-slate-600">
                  Revísalas, aprueba o pide cambios en un clic.
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400" />
            </div>
          </Link>
        )}

        <section>
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
            <FolderKanban className="h-4 w-4" />
            Proyectos en marcha ({data.projects.length})
          </h2>
          {data.projects.length === 0 ? (
            <p className="text-sm text-slate-500 italic px-1">
              No hay proyectos activos en este momento.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.projects.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border p-5">
                  <div className="flex items-start gap-3 mb-2">
                    <span className="h-3 w-3 rounded-full mt-1.5 shrink-0" style={{ background: accent }} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate">{p.name}</h3>
                      {p.description && (
                        <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{p.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Progreso</span>
                      <span className="font-medium text-slate-700">{p.progress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${p.progress}%`, background: accent }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {data.events.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
              <CalendarDays className="h-4 w-4" />
              Próximos eventos
            </h2>
            <div className="bg-white rounded-xl border divide-y">
              {data.events.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="text-xs text-slate-500 w-16 shrink-0">
                    {new Date(e.startAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 truncate">{e.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {e.allDay
                        ? "Todo el día"
                        : new Date(e.startAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      {" · "}{labelEventType(e.type)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <ClientDeliverablesSection token={token} accent={accent} />

        <section>
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
            <CheckCircle2 className="h-4 w-4" />
            Calendario editorial de {monthLabel}
          </h2>
          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Total" value={data.editorial.total} />
            <Stat label="Aprobadas" value={data.editorial.approved} tone="ok" />
            <Stat label="Esperando tu OK" value={data.editorial.review} tone="warn" />
            <Stat label="Rechazadas" value={data.editorial.rejected} tone="danger" />
          </div>
          {data.editorial.review > 0 && (
            <div className="mt-3">
              <Link
                href={data.approvalUrl}
                className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"
              >
                Ir al panel de aprobación
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </section>

        <footer className="text-xs text-slate-400 text-center py-6 border-t">
          Este portal es privado. Acceso vía link único.
          {data.expiresAt && (
            <> Caduca el {new Date(data.expiresAt).toLocaleDateString("es-ES")}.</>
          )}
        </footer>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "danger"
          ? "text-rose-700"
          : "text-slate-900";
  return (
    <div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function labelEventType(t: string): string {
  switch (t) {
    case "MEETING":
      return "Reunión";
    case "PUBLICATION":
      return "Publicación";
    case "DEADLINE":
      return "Fecha límite";
    default:
      return t.toLowerCase();
  }
}
