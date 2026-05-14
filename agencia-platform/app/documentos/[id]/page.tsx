import Link from "next/link";
import { notFound } from "next/navigation";
import { docs } from "@/lib/mock-data";
import { ArrowLeft, FileText, FileSignature, Users, Sparkles, Info, Share2, Star } from "lucide-react";

const iconMap: Record<string, any> = { FileText, FileSignature, Users, Sparkles };

export function generateStaticParams() {
  return docs.map((d) => ({ id: d.id }));
}

export default function DocDetailPage({ params }: { params: { id: string } }) {
  const doc = docs.find((d) => d.id === params.id);
  if (!doc) notFound();

  const Icon = iconMap[doc.icon] || FileText;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/documentos"
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a documentos
      </Link>

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-brand-50 text-brand-600 grid place-items-center">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">{doc.category}</div>
            <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900">
            <Star className="h-4 w-4" />
          </button>
          <button className="h-9 w-9 rounded-lg border bg-white grid place-items-center text-slate-500 hover:text-slate-900">
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-8">
        Por {doc.author} · Actualizado el{" "}
        {new Date(doc.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
      </div>

      <article className="prose-styled space-y-5">
        {doc.blocks.map((b, i) => {
          if (b.type === "heading")
            return (
              <h2 key={i} className="text-xl font-semibold tracking-tight mt-6">
                {b.text as string}
              </h2>
            );
          if (b.type === "paragraph")
            return (
              <p key={i} className="text-[15px] leading-relaxed text-slate-700">
                {b.text as string}
              </p>
            );
          if (b.type === "list")
            return (
              <ul key={i} className="space-y-1.5 text-[15px] text-slate-700 ml-1">
                {(b.text as string[]).map((item, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 mt-2.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            );
          if (b.type === "callout")
            return (
              <div key={i} className="flex gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                <Info className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-900">{b.text as string}</p>
              </div>
            );
          return null;
        })}
      </article>

      <div className="border-t mt-12 pt-6 text-xs text-slate-400">
        Este documento es interno. Edítalo añadiendo bloques al estilo Notion.
      </div>
    </div>
  );
}
