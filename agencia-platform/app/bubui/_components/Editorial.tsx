/**
 * Bloque editorial SEO reutilizable (server component): intro, secciones y
 * FAQ con su JSON-LD (FAQPage) para rich results en Google.
 */
import type { EditorialContent } from "@/lib/bubui/editorial";
import { faqJsonLd } from "@/lib/bubui/editorial";

export default function Editorial({ content }: { content: EditorialContent }) {
  return (
    <section className="max-w-5xl mx-auto px-4 py-12">
      {content.faq.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(content.faq)) }} />
      )}

      <div className="prose prose-slate max-w-none">
        {content.intro.map((p, i) => (
          <p key={i} className="text-slate-700 leading-relaxed">{p}</p>
        ))}
      </div>

      {content.sections.map((s, i) => (
        <div key={i} className="mt-8">
          <h2 className="text-xl font-bold text-slate-900">{s.h}</h2>
          <p className="mt-2 text-slate-700 leading-relaxed">{s.p}</p>
        </div>
      ))}

      {content.faq.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xl font-bold text-slate-900 mb-3">Preguntas frecuentes</h2>
          <dl className="space-y-4">
            {content.faq.map((f, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="font-semibold text-slate-900">{f.q}</dt>
                <dd className="mt-1 text-slate-600 text-sm leading-relaxed">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
