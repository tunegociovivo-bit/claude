"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md"
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Al abrir, empezar SIEMPRE por arriba. Algunos editores (tiptap) roban el
  // foco al montar y el navegador baja el scroll al fondo; reseteamos en los
  // primeros frames tras abrir para que se vea la parte superior de la tarea.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const r = requestAnimationFrame(() => { el.scrollTop = 0; });
    const t1 = setTimeout(() => { el.scrollTop = 0; }, 60);
    const t2 = setTimeout(() => { el.scrollTop = 0; }, 180);
    return () => { cancelAnimationFrame(r); clearTimeout(t1); clearTimeout(t2); };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          // En móvil: pantalla completa pegado al inferior con esquinas
          // redondeadas arriba. En sm+: modal centrado.
          "relative bg-white shadow-xl w-full flex flex-col",
          "h-[100dvh] sm:h-auto sm:max-h-[90vh]",
          "rounded-t-2xl sm:rounded-2xl",
          {
            "sm:max-w-sm": size === "sm",
            "sm:max-w-md": size === "md",
            "sm:max-w-2xl": size === "lg",
            "sm:max-w-4xl": size === "xl"
          }
        )}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b shrink-0">
          <h2 className="text-base font-semibold truncate pr-2">{title}</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">{children}</div>
        {footer && (
          <div className="px-4 sm:px-5 py-3 border-t bg-slate-50 sm:rounded-b-2xl flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
