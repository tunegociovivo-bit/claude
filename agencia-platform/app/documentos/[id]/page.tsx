"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Star, Share2, MoreHorizontal, Plus, Loader2 } from "lucide-react";
import { docs as mockDocs } from "@/lib/mock-data";
import DocAIButton from "@/components/ai/DocAIButton";

const BlockEditor = dynamic(() => import("@/components/editor/BlockEditor"), { ssr: false });

type Doc = {
  id: string;
  title: string;
  icon: string | null;
  category: string | null;
  content: any;
  children?: { id: string; title: string; icon: string | null }[];
};

function mockDocToDoc(id: string): Doc | null {
  const m = mockDocs.find((d) => d.id === id);
  if (!m) return null;
  const content = {
    type: "doc",
    content: m.blocks.map((b) => {
      if (b.type === "heading") return { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: b.text as string }] };
      if (b.type === "paragraph") return { type: "paragraph", content: [{ type: "text", text: b.text as string }] };
      if (b.type === "list")
        return {
          type: "bulletList",
          content: (b.text as string[]).map((t) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: t }] }]
          }))
        };
      if (b.type === "callout") return { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: b.text as string }] }] };
      return { type: "paragraph" };
    })
  };
  return { id: m.id, title: m.title, icon: m.icon, category: m.category, content };
}

export default function DocDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/v1/documents/${params.id}`);
        if (r.ok) {
          const data = await r.json();
          if (!aborted) {
            setDoc(data);
            setTitle(data.title);
          }
        } else {
          // Fallback: mock data si el doc no existe en BD
          const fallback = mockDocToDoc(params.id);
          if (fallback && !aborted) {
            setDoc(fallback);
            setTitle(fallback.title);
          }
        }
      } catch {
        const fallback = mockDocToDoc(params.id);
        if (fallback && !aborted) {
          setDoc(fallback);
          setTitle(fallback.title);
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [params.id]);

  async function saveTitle() {
    if (!doc || title === doc.title) return;
    await fetch(`/api/v1/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    }).catch(() => {});
    setDoc({ ...doc, title });
  }

  async function createSubpage() {
    if (!doc) return;
    const r = await fetch("/api/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Sin título", parentId: doc.id })
    });
    if (r.ok) {
      const created = await r.json();
      router.push(`/documentos/${created.id}`);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando documento…
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="max-w-3xl mx-auto text-sm text-slate-500">
        Documento no encontrado.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/documentos"
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a documentos
      </Link>

      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <button className="text-3xl leading-none">{doc.icon && /\p{Emoji}/u.test(doc.icon) ? doc.icon : "📄"}</button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="flex-1 text-3xl font-semibold tracking-tight bg-transparent focus:outline-none placeholder:text-slate-300"
            placeholder="Sin título"
          />
        </div>
        <div className="flex items-center gap-2">
          <DocAIButton documentId={doc.id} />
          <button onClick={createSubpage} className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border bg-white hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" /> Subpágina
          </button>
          <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900">
            <Star className="h-4 w-4" />
          </button>
          <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900">
            <Share2 className="h-4 w-4" />
          </button>
          <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-400 mb-6">
        {doc.category && <span className="uppercase tracking-wide">{doc.category}</span>}
      </div>

      <BlockEditor documentId={doc.id} initialContent={doc.content} />

      {doc.children && doc.children.length > 0 && (
        <div className="mt-12 pt-6 border-t">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">Subpáginas</h3>
          <ul className="space-y-1">
            {doc.children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/documentos/${c.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-sm"
                >
                  <span>{c.icon ?? "📄"}</span>
                  <span>{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
