"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import DocTree from "@/components/DocTree";
import { Plus, FileText, Search, FolderTree, Loader2 } from "lucide-react";
import { docs as mockDocs } from "@/lib/mock-data";

type DocRow = {
  id: string;
  title: string;
  icon: string | null;
  category: string | null;
  updatedAt: string;
  excerpt?: string;
  author?: string;
};

export default function DocumentosPage() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const r = await fetch("/api/v1/documents");
        if (r.ok) {
          const data = await r.json();
          if (!aborted && data.items?.length) {
            setDocs(data.items);
            return;
          }
        }
      } catch {
        // fall through
      }
      if (!aborted) {
        setUsingFallback(true);
        setDocs(
          mockDocs.map((d) => ({
            id: d.id,
            title: d.title,
            icon: d.icon,
            category: d.category,
            updatedAt: d.updatedAt,
            excerpt: d.excerpt,
            author: d.author
          }))
        );
      }
    })().finally(() => !aborted && setLoading(false));
    return () => {
      aborted = true;
    };
  }, []);

  async function createDoc() {
    const r = await fetch("/api/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Sin título" })
    });
    if (r.ok) {
      const created = await r.json();
      window.location.href = `/documentos/${created.id}`;
    }
  }

  const categories = Array.from(new Set(docs.map((d) => d.category).filter(Boolean) as string[]));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Documentos y wiki"
        description="Base de conocimiento interna de la agencia."
        actions={
          <button
            onClick={createDoc}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
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
              Árbol de páginas
            </div>
            {usingFallback ? (
              <div className="text-xs text-slate-500 px-2 py-2 italic">
                Conecta la BD para ver el árbol completo con subpáginas.
              </div>
            ) : (
              <DocTree />
            )}

            {categories.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-500 mt-4 mb-2 px-2">Categorías</div>
                <ul className="space-y-0.5">
                  {categories.map((cat) => (
                    <li key={cat}>
                      <button className="w-full text-left px-2 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-50">
                        {cat} ({docs.filter((d) => d.category === cat).length})
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>

        <div className="lg:col-span-3">
          {loading ? (
            <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando documentos…
            </div>
          ) : docs.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-sm text-slate-500">
              No hay documentos todavía. <button onClick={createDoc} className="text-brand-600 underline">Crea el primero</button>.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {docs.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/documentos/${doc.id}`}
                  className="bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="h-10 w-10 rounded-lg bg-brand-50 text-brand-600 grid place-items-center text-lg">
                      {doc.icon && /\p{Emoji}/u.test(doc.icon) ? doc.icon : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {doc.category && (
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">{doc.category}</div>
                      )}
                      <h3 className="font-semibold leading-tight">{doc.title}</h3>
                    </div>
                  </div>
                  {doc.excerpt && <p className="text-sm text-slate-600 line-clamp-2">{doc.excerpt}</p>}
                  <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-slate-500">
                    <span>{doc.author ? `Por ${doc.author}` : ""}</span>
                    <span>
                      {new Date(doc.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
