import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { docs } from "@/lib/mock-data";
import { Plus, FileText, FileSignature, Users, Sparkles, Search, FolderTree } from "lucide-react";

const iconMap: Record<string, any> = { FileText, FileSignature, Users, Sparkles };

export default function DocumentosPage() {
  const categories = Array.from(new Set(docs.map((d) => d.category)));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Documentos y wiki"
        description="Base de conocimiento interna de la agencia."
        actions={
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
            <Plus className="h-4 w-4" />
            Nuevo documento
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border p-4">
            <div className="relative mb-3">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Buscar…"
                className="w-full pl-9 pr-3 py-1.5 rounded-md bg-slate-50 border text-sm focus:outline-none"
              />
            </div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 px-2 flex items-center gap-1">
              <FolderTree className="h-3.5 w-3.5" />
              Categorías
            </div>
            <ul className="space-y-0.5">
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-sm bg-brand-50 text-brand-700 font-medium">
                  Todos ({docs.length})
                </button>
              </li>
              {categories.map((cat) => (
                <li key={cat}>
                  <button className="w-full text-left px-2 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-50">
                    {cat} ({docs.filter((d) => d.category === cat).length})
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.map((doc) => {
            const Icon = iconMap[doc.icon] || FileText;
            return (
              <Link
                key={doc.id}
                href={`/documentos/${doc.id}`}
                className="bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-brand-50 text-brand-600 grid place-items-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{doc.category}</div>
                    <h3 className="font-semibold leading-tight">{doc.title}</h3>
                  </div>
                </div>
                <p className="text-sm text-slate-600 line-clamp-2">{doc.excerpt}</p>
                <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-slate-500">
                  <span>Por {doc.author}</span>
                  <span>
                    Actualizado{" "}
                    {new Date(doc.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
