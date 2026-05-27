"use client";

import { useState } from "react";
import { Mic, Plus, X, Type, AudioLines } from "lucide-react";

/**
 * Dos floating action buttons (FABs) en mobile para /tareas:
 *
 *   ╭──────────────╮  Reunión rápida — rojo. Click directo:
 *   │  🎤  ▸       │   crea una tarea con título auto
 *   ╰──────────────╯   ("Reunión 16/05 14:30") y abre el grabador.
 *
 *   ╭──────────────╮  Crear tarea — brand. Click:
 *   │   +          │   abre un mini-menú con dos opciones:
 *   ╰──────────────╯     · Voz (Whisper + Claude maquetan)
 *                        · Texto (form normal)
 *
 * Solo visible en pantallas <md. Pensados para uso con pulgar —
 * esquina inferior derecha siempre accesible.
 */
export default function MobileFABs({
  onQuickMeeting,
  onTaskByVoice,
  onTaskByText
}: {
  onQuickMeeting: () => void;
  onTaskByVoice: () => void;
  onTaskByText: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Backdrop tenue para cerrar el menú al pulsar fuera */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60] bg-slate-900/20 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="md:hidden fixed bottom-20 right-4 z-[61] flex flex-col items-end gap-3">
        {/* Mini-menú "Crear tarea por voz / texto" */}
        {menuOpen && (
          <div className="flex flex-col items-end gap-2 mb-1">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onTaskByVoice();
              }}
              className="inline-flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-white shadow-lg border text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <span className="h-7 w-7 rounded-full bg-rose-100 grid place-items-center">
                <AudioLines className="h-4 w-4 text-rose-600" />
              </span>
              Por voz
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onTaskByText();
              }}
              className="inline-flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-white shadow-lg border text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <span className="h-7 w-7 rounded-full bg-brand-100 grid place-items-center">
                <Type className="h-4 w-4 text-brand-600" />
              </span>
              Por texto
            </button>
          </div>
        )}

        {/* FAB 1: Reunión rápida */}
        <button
          type="button"
          onClick={onQuickMeeting}
          className="h-14 w-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-300/50 grid place-items-center"
          title="Reunión rápida: crear tarea y grabar"
          aria-label="Reunión rápida"
        >
          <Mic className="h-6 w-6" />
        </button>

        {/* FAB 2: Crear tarea (despliega menú) */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="h-16 w-16 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-xl shadow-brand-300/50 grid place-items-center"
          title="Crear tarea"
          aria-label="Crear tarea"
        >
          {menuOpen ? <X className="h-7 w-7" /> : <Plus className="h-7 w-7" />}
        </button>
      </div>
    </>
  );
}
