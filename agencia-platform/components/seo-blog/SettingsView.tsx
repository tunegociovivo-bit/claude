"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Card, Field, inputCls } from "./ui";

export default function SettingsView({ nav }: { nav: Nav }) {
  const s = nav.settings ?? {};
  const [f, setF] = useState<Record<string, any>>({ ...s, serperApiKey: "", freepikApiKey: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<any>(null);
  useEffect(() => {
    api("/settings/check").then(setCheck).catch(() => setCheck(null));
  }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const inp = (k: string, label: string, help?: string, type = "text") => (
    <Field label={label} help={help}><input type={type} value={f[k] ?? ""} onChange={set(k)} className={inputCls} /></Field>
  );
  if (!s.isAdmin) return <p className="text-sm text-slate-500">Solo los administradores pueden cambiar los ajustes.</p>;
  return (
    <div className="space-y-4">
      <Card title="Claves compartidas del Hub">
        <ul className="text-sm space-y-1">
          <li>{s.anthropicConfigured ? "✅" : "⚠️"} Anthropic (Claude) — se configura en <a className="text-amber-700 underline" href="/admin/ai">Configuración de IA</a>.</li>
          <li>{s.freepikConfigured ? (check?.freepik ? (check.freepik.ok ? "✅" : "❌") : "⏳") : "⚠️"} Freepik / Magnific (imágenes Seedream 4.5)
            {check?.freepik && <span className={check.freepik.ok ? "text-emerald-700" : "text-rose-700"}> — {check.freepik.message}</span>}</li>
        </ul>
        <div className={clsx("mt-3 rounded-lg border p-3", check?.freepik && !check.freepik.ok ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50")}>
          <Field label="API key de Freepik / Magnific" help={check?.freepik?.ok ? "Guardada y válida. Escribe una nueva solo para cambiarla." : "Genera una en magnific.com → API → Dashboard → API key, pégala aquí y pulsa «Guardar ajustes». Se comprueba al instante y sirve también para el calendario editorial."}>
            <input type="password" autoComplete="new-password" value={f.freepikApiKey} onChange={set("freepikApiKey")} placeholder={s.freepikConfigured ? "••••••••" : "FPSX…"} className={inputCls} />
          </Field>
        </div>
      </Card>
      <Card title="Datos de Google (Serper.dev)">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="API key de Serper.dev" help={s.serperConfigured ? "Guardada. Escribe una nueva para cambiarla." : "Muy recomendada: top 10 real, «La gente también pregunta» y estructura de la competencia."}>
            <input type="password" autoComplete="new-password" value={f.serperApiKey} onChange={set("serperApiKey")} placeholder={s.serperConfigured ? "••••••••" : ""} className={inputCls} />
          </Field>
          {inp("serperGl", "País (gl)")}
          {inp("serperHl", "Idioma (hl)")}
        </div>
      </Card>
      <Card title="Modelos de IA">
        <div className="grid sm:grid-cols-2 gap-4">
          {inp("modelWriter", "Redacción y humanización", "Máxima calidad de escritura.")}
          {inp("modelFast", "Propuestas, briefs y análisis de estilo")}
        </div>
      </Card>
      <Card title="Imágenes (Freepik / Magnific)">
        <div className="grid sm:grid-cols-2 gap-4">
          {inp("freepikBase", "URL base de la API", "https://api.freepik.com (o https://api.magnific.com)")}
          {inp("freepikHeader", "Cabecera de autenticación", "x-freepik-api-key (o x-magnific-api-key)")}
          {inp("freepikEditPath", "Endpoint con referencias de estilo")}
          {inp("freepikT2iPath", "Endpoint sin referencias")}
        </div>
      </Card>
      <Card title="Calidad y flujo">
        <div className="grid sm:grid-cols-3 gap-4">
          {inp("seoMinScore", "Puntuación SEO mínima", "Por debajo, la IA hace pasadas de corrección automáticas.", "number")}
          {inp("maxFixPasses", "Pasadas de corrección máximas", undefined, "number")}
          {inp("ideasPerRun", "Propuestas por tanda", undefined, "number")}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          La cola se procesa automáticamente cada 2 minutos con el planificador interno del Hub. Opcionalmente puedes llamarla desde fuera con
          <code className="mx-1">GET /api/cron/seo-blog-tick</code> y la cabecera <code>Authorization: Bearer INTERNAL_CRON_TOKEN</code>.
        </p>
      </Card>
      <div className="flex justify-end items-center gap-3">
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
        <Btn busy={busy} onClick={async () => {
          setBusy(true);
          try {
            await api("/settings", { method: "PATCH", body: { ...f, serperApiKey: f.serperApiKey || undefined, freepikApiKey: f.freepikApiKey || undefined } });
            await nav.reloadSettings();
            const c = await api("/settings/check").catch(() => null);
            setCheck(c);
            setF((x) => ({ ...x, freepikApiKey: "" }));
            setMsg(c?.freepik && !c.freepik.ok ? `Ajustes guardados, pero Freepik: ${c.freepik.message}` : "Ajustes guardados ✓ · Freepik OK");
          } catch (e: any) {
            setMsg(e.message);
          } finally {
            setBusy(false);
          }
        }}>Guardar ajustes</Btn>
      </div>
    </div>
  );
}
