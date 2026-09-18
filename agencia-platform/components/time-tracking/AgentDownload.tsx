import { Download } from "lucide-react";
import { TIME_AGENT_MAC_URL, TIME_AGENT_WINDOWS_URL } from "@/lib/time-agent-download";

export default function AgentDownload({ login = false }: { login?: boolean }) {
  return (
    <aside className={`rounded-xl border border-brand-200 bg-brand-50 p-4 ${login ? "mb-6" : "mb-3 flex flex-wrap items-center justify-between gap-3"}`} aria-label="Software de control horario">
      <div>
        <p className="text-sm font-semibold text-slate-900">
          {login ? "Instalación imprescindible" : "Software de control horario"}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {login
            ? "Es imprescindible instalar el software de Negocio Vivo para poder usar el CRM."
            : "Descarga e instala Negocio Vivo en tu equipo para registrar tu jornada."}
        </p>
      </div>
      <div className={`flex flex-wrap gap-3 ${login ? "mt-3" : ""}`}>
        {[
          { href: TIME_AGENT_WINDOWS_URL, label: "Descargar para Windows" },
          { href: TIME_AGENT_MAC_URL, label: "Descargar para Mac" },
        ].map(({ href, label }) => (
          <a key={href} href={href} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-600">Windows de 64 bits o macOS 14 y posterior (Intel y Apple Silicon). En Mac, abre el DMG y arrastra el programa a Aplicaciones. Vincula tu equipo con la credencial que te facilite el administrador.</p>
    </aside>
  );
}
