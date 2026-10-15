"use client";

import { Mail, Megaphone } from "lucide-react";

// Datos del formulario de Meta guardados en la ficha (contact.leadInfo).
export type LeadInfoEntryView = {
  id: string | null;
  at: string;
  campaign: string | null;
  treatment: string | null;
  form: string | null;
  adName: string | null;
  adset?: string | null;
  lineLabel: string | null;
  fields: Array<{ label: string; value: string }>;
};

const CONTACT_LABELS = new Set(["email", "teléfono recibido"]);

export function leadWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// «Recomposición corporal» o la campaña si no hay tratamiento.
export function leadHeadline(entry: LeadInfoEntryView | undefined | null): string | null {
  if (!entry) return null;
  return entry.treatment || entry.campaign || "Formulario de Meta";
}

// Respuestas del formulario en una línea («marcación abdominal · en los próximos 3 meses»).
export function leadAnswersSummary(entry: LeadInfoEntryView | undefined | null): string {
  if (!entry) return "";
  return (entry.fields ?? [])
    .filter((f) => f && f.value && !CONTACT_LABELS.has(String(f.label).toLowerCase()))
    .map((f) => f.value)
    .join(" · ");
}

// Todo lo que llegó del formulario: tratamiento, fecha, número del CRM, campaña,
// conjunto, anuncio, email y cada pregunta con su respuesta.
export default function LeadDetails({ entries, email }: { entries: LeadInfoEntryView[]; email?: string | null }) {
  const emailInFields = entries.some((e) => (e.fields ?? []).some((f) => String(f.label).toLowerCase() === "email" && f.value === email));
  if (!entries.length && !email) return null;
  return (
    <div className="space-y-2">
      {email && !emailInFields && (
        <p className="flex items-center gap-1.5 text-sm text-slate-700">
          <Mail size={14} className="shrink-0 text-slate-400" />
          <a className="min-w-0 truncate underline" href={`mailto:${email}`}>{email}</a>
        </p>
      )}
      {entries.map((e, i) => {
        const meta = [
          e.campaign && e.campaign !== e.treatment ? ["Campaña", e.campaign] : null,
          e.adset ? ["Conjunto", e.adset] : null,
          e.adName ? ["Anuncio", e.adName] : null,
        ].filter(Boolean) as Array<[string, string]>;
        return (
          <div key={`${e.id ?? "x"}-${i}`} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-100">
            <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-slate-900">
              <Megaphone size={14} className="shrink-0 text-brand-600" />
              {leadHeadline(e)}
              <span className="text-xs font-normal text-slate-500">
                {leadWhen(e.at)}
                {e.lineLabel ? ` · ${e.lineLabel}` : ""}
              </span>
            </p>
            <dl className="space-y-1.5">
              {(e.fields ?? []).map((f, j) => (
                <div key={`f${j}`}>
                  <dt className="text-xs text-slate-500">{f.label}</dt>
                  <dd className="break-words font-medium text-slate-900">
                    {String(f.label).toLowerCase() === "email" ? <a className="underline" href={`mailto:${f.value}`}>{f.value}</a> : f.value}
                  </dd>
                </div>
              ))}
              {meta.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="break-words text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
