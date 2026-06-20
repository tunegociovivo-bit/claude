"use client";

/**
 * Buscador del directorio (cliente): filtra al instante sobre la lista de
 * sectores, localidades y pares sector+localidad que le pasa el servidor.
 */
import { useMemo, useState } from "react";
import Link from "next/link";

export type SearchItem = { label: string; href: string };

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function DirectorySearch({ items }: { items: SearchItem[] }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) return [];
    return items.filter((i) => norm(i.label).includes(nq)).slice(0, 12);
  }, [q, items]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Busca tu sector o localidad (ej. peluquerías Benalmádena)"
        className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm shadow-sm focus:border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-100"
        aria-label="Buscar en el directorio"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {results.map((r) => (
            <li key={r.href}>
              <Link href={r.href} className="block px-5 py-2.5 text-sm text-slate-700 hover:bg-pink-50 hover:text-pink-700">
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
