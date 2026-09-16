import { Download } from "lucide-react";
import { TIME_AGENT_WINDOWS_URL } from "@/lib/time-agent-download";

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
      <a href={TIME_AGENT_WINDOWS_URL} className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${login ? "mt-3 w-full" : ""}`}>
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        Descargar para Windows
      </a>
      {login && <p className="mt-2 text-xs text-slate-600">Windows de 64 bits. Tras instalarlo, abre el acceso del escritorio y vincula tu equipo con la credencial que te facilite el administrador.</p>}
    </aside>
  );
}
