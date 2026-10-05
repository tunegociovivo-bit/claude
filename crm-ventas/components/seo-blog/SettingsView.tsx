"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import type { Nav } from "./SeoBlogApp";
import { api, Btn, Card, Field, inputCls } from "./ui";

/**
 * Ajustes del Publicador SEO para el negocio (solo administradores). Sin claves
 * ni modelos: eso lo gestiona Negocio Vivo. Solo preferencias propias.
 */
export default function SettingsView({ nav }: { nav: Nav }) {
  const s = nav.settings ?? {};
  const services = s.services ?? {};
  const [f, setF] = useState<Record<string, any>>({ notifyEmail: s.notifyEmail ?? "", seoMinScore: s.seoMinScore ?? 85, ideasPerRun: s.ideasPerRun ?? 12 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [reset, setReset] = useState(false);
  useEffect(() => {
    setF({ notifyEmail: s.notifyEmail ?? "", seoMinScore: s.seoMinScore ?? 85, ideasPerRun: s.ideasPerRun ?? 12 });
  }, [s.notifyEmail, s.seoMinScore, s.ideasPerRun]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (!nav.isAdmin) return <p className="text-sm text-slate-500">Solo los administradores pueden cambiar los ajustes.</p>;
  const Row = ({ ok, label, off }: { ok: boolean; label: string; off: string }) => (
    <li className="flex items-start gap-2"><span>{ok ? "✅" : "⚠️"}</span><span><b>{label}</b>{ok ? " — disponible" : ` — ${off}`}</span></li>
  );
  return (
    <div className="space-y-4">
      <Card title="Servicios disponibles">
        <ul className="text-sm space-y-1.5">
          <Row ok={!!services.writing} label="Redacción con IA" off="no disponible ahora mismo; avisa a Negocio Vivo." />
          <Row ok={!!services.images} label="Generación de imágenes" off="no disponible; los posts se crean sin imágenes. Avisa a Negocio Vivo." />
          <Row ok={!!services.google} label="Datos de Google (top 10, «La gente también pregunta»)" off="no disponibles; la IA trabaja sin ellos." />
        </ul>
        {services.images && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn variant="ghost" size="sm" busy={checking} onClick={async () => {
              setChecking(true);
              try {
                setCheck(await api("/settings/check"));
              } catch (e: any) {
                setCheck({ freepik: { ok: false, message: e.message } });
              } finally {
                setChecking(false);
              }
            }}>Comprobar generación de imágenes</Btn>
            {check?.freepik && <span className={"text-xs " + (check.freepik.ok ? "text-emerald-700" : "text-rose-700")}>{check.freepik.message}</span>}
          </div>
        )}
        <p className="text-xs text-slate-500 mt-3">Las claves y los modelos de IA los gestiona Negocio Vivo; no tienes que configurar nada.</p>
      </Card>
      <Card title="Avisos y calidad">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Email de aviso" help="Te avisamos cuando un post esté listo para revisar. Vacío = sin avisos por email.">
            <input type="email" value={f.notifyEmail ?? ""} onChange={set("notifyEmail")} placeholder="tu@email.com" className={inputCls} />
          </Field>
          <Field label="Puntuación SEO mínima" help="Por debajo, la IA hace pasadas de corrección automáticas (50–100).">
            <input type="number" min={50} max={100} value={f.seoMinScore ?? ""} onChange={set("seoMinScore")} className={inputCls} />
          </Field>
          <Field label="Propuestas por tanda" help="Cuántas ideas propone la IA cada vez (3–30).">
            <input type="number" min={3} max={30} value={f.ideasPerRun ?? ""} onChange={set("ideasPerRun")} className={inputCls} />
          </Field>
        </div>
        <div className="flex justify-end items-center gap-3 mt-4 flex-wrap">
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
          <Btn busy={busy} onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              await api("/settings", { method: "PATCH", body: f });
              await nav.reloadSettings();
              setMsg("Ajustes guardados ✓");
            } catch (e: any) {
              setMsg(e.message);
            } finally {
              setBusy(false);
            }
          }}>Guardar ajustes</Btn>
        </div>
        <p className="text-xs text-slate-500 mt-3">La cola se procesa automáticamente cada 2 minutos. También puedes forzarla desde el Panel con «Procesar cola ahora».</p>
      </Card>
      <Card title="Zona de peligro" className="border-rose-200">
        <p className="text-sm text-slate-600">Borra todas las palabras clave, referencias visuales, propuestas, posts y el registro del Publicador. No se toca nada en tu WordPress (los posts ya publicados siguen allí) ni en tu ficha de marca.</p>
        <Btn variant="danger" className="mt-3" onClick={() => setReset(true)}><Trash2 className="h-4 w-4" /> Borrar datos del Publicador…</Btn>
      </Card>
      <ResetModal open={reset} onClose={() => setReset(false)} nav={nav} />
    </div>
  );
}

function ResetModal({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: Nav }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setText(""); setErr(""); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Borrar datos del Publicador"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn variant="danger" busy={busy} disabled={text.trim().toUpperCase() !== "BORRAR"} onClick={async () => {
        setBusy(true);
        try {
          await api(`/sites/${nav.site.id}`, { method: "DELETE" });
          onClose();
          await nav.reloadSite();
          nav.go("panel");
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}>Borrar definitivamente</Btn></>}>
      <p className="text-sm mb-3">Esta acción no se puede deshacer. También se desconecta tu WordPress (habrá que volver a conectarlo). Escribe <b>BORRAR</b> para confirmar.</p>
      <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} autoFocus />
      {err && <p className="text-sm text-rose-600 mt-2">{err}</p>}
    </Modal>
  );
}
