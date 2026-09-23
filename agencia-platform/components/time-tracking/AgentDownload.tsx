"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { TIME_AGENT_MAC_URL, TIME_AGENT_WINDOWS_URL } from "@/lib/time-agent-download";

const DISMISS_KEY = "nv-time-agent-download-dismissed-until";
const DISMISS_DAYS = 30;
const DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

type InstallationStatus = {
  installed?: boolean;
};

function readDismissedUntil() {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

export default function AgentDownload({ login = false }: { login?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkInstallation() {
      const dismissedUntil = readDismissedUntil();
      if (dismissedUntil > Date.now()) {
        if (!cancelled) {
          setVisible(false);
          setReady(true);
        }
        return;
      }

      try {
        const response = await fetch("/api/v1/time-tracking/installation-status", {
          credentials: "same-origin",
          cache: "no-store"
        });
        if (response.ok) {
          const data = (await response.json()) as InstallationStatus;
          if (data.installed) {
            if (!cancelled) {
              setVisible(false);
              setReady(true);
            }
            return;
          }
        }
      } catch {
        // Si el navegador no puede confirmar la instalación, mostramos el aviso
        // y permitimos cerrarlo temporalmente desde este equipo.
      }

      if (!cancelled) {
        setVisible(true);
        setReady(true);
      }
    }

    void checkInstallation();

    return () => {
      cancelled = true;
    };
  }, []);

  function dismissForMonth() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
    setVisible(false);
  }

  if (!ready || !visible) return null;

  return (
    <aside className={`relative rounded-xl border border-brand-200 bg-brand-50 p-4 pr-12 ${login ? "mb-6" : "mb-3 flex flex-wrap items-center justify-between gap-3"}`} aria-label="Software de control horario">
      <button
        type="button"
        onClick={dismissForMonth}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/80 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        aria-label="Cerrar este aviso durante 30 días"
        title="Cerrar este aviso durante 30 días"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div>
        <p className="text-sm font-semibold text-slate-900">
          {login ? "Instalación imprescindible" : "Software de control horario"}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {login
            ? "Es imprescindible instalar el software de Negocio Vivo para poder usar el CRM. Si ya lo tienes instalado, puedes cerrar este aviso durante 30 días."
            : "Descarga e instala Negocio Vivo en tu equipo para registrar tu jornada. Si ya lo tienes instalado, puedes cerrar este aviso durante 30 días."}
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
