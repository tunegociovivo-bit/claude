import type { ReactNode } from "react";

export default function PageHeader({
  title,
  description,
  actions,
  center,
  dense
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Contenido opcional en el centro de la cabecera (p.ej. indicadores). */
  center?: ReactNode;
  /** Reduce el margen inferior. Para vistas tipo tablero donde el
   *  contenido (columnas) necesita ganar todo el espacio vertical. */
  dense?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 " +
        (dense ? "mb-2" : "mb-4 sm:mb-6")
      }
    >
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {center && <div className="sm:flex-1 flex sm:justify-center">{center}</div>}
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
