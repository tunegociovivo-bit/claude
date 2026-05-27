import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/PageHeader";
import { getClientsForUi, getProjectsForUi, getTasksForUi } from "@/lib/db/queries";
import { Building2, FileText, KanbanSquare, Search } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BuscarPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").toLowerCase().trim();
  return (
    <Suspense>
      <Results q={q} />
    </Suspense>
  );
}

async function Results({ q }: { q: string }) {
  const [clients, projects, tasks] = await Promise.all([
    getClientsForUi(),
    getProjectsForUi(),
    getTasksForUi()
  ]);

  const matchedClients = q ? clients.filter((c) => c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q)) : [];
  const matchedProjects = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : [];
  const matchedTasks = q ? tasks.filter((t) => t.title.toLowerCase().includes(q)) : [];

  const total = matchedClients.length + matchedProjects.length + matchedTasks.length;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={q ? `Resultados para "${q}"` : "Buscar"}
        description={q ? `${total} coincidencias` : "Escribe en la barra superior y pulsa Enter."}
      />

      {q === "" ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <div className="h-12 w-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3 text-slate-400">
            <Search className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-600">Empieza a escribir arriba.</p>
        </div>
      ) : total === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          Sin resultados para "<span className="font-medium">{q}</span>".
        </div>
      ) : (
        <div className="space-y-6">
          {matchedTasks.length > 0 && (
            <Section title="Tareas" count={matchedTasks.length}>
              {matchedTasks.map((t) => (
                <Link
                  key={t.id}
                  href={`/tareas?project=${t.projectId}`}
                  className="block bg-white rounded-lg border p-3 hover:border-brand-300 hover:bg-brand-50/20"
                >
                  <div className="flex items-center gap-3">
                    <KanbanSquare className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">{t.title}</span>
                  </div>
                </Link>
              ))}
            </Section>
          )}
          {matchedProjects.length > 0 && (
            <Section title="Proyectos" count={matchedProjects.length}>
              {matchedProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/tareas?project=${p.id}`}
                  className="block bg-white rounded-lg border p-3 hover:border-brand-300 hover:bg-brand-50/20"
                >
                  <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${p.color}`} />
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-xs text-slate-500 truncate">{p.description}</span>
                  </div>
                </Link>
              ))}
            </Section>
          )}
          {matchedClients.length > 0 && (
            <Section title="Clientes" count={matchedClients.length}>
              {matchedClients.map((c) => (
                <Link
                  key={c.id}
                  href={`/clientes/${c.id}`}
                  className="block bg-white rounded-lg border p-3 hover:border-brand-300 hover:bg-brand-50/20"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-slate-500">{c.industry}</span>
                  </div>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-2">
        <FileText className="h-3 w-3" />
        {title} <span className="text-slate-400 font-normal">({count})</span>
      </h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
