"use client";

import { useEffect, useState } from "react";
import { Download, Mic, Bell, ShieldCheck, Loader2, Copy, CheckCircle2 } from "lucide-react";

/**
 * Página de descarga e instalación de la extensión Hub Negocio Vivo
 * para Chrome. No la publicamos en la Chrome Web Store (es interna),
 * los trabajadores descargan el .zip desde aquí y lo cargan
 * manualmente en chrome://extensions con "Modo de desarrollador".
 *
 * La descarga la sirve el endpoint /api/v1/extension/download que
 * zipea la carpeta chrome-extension/ al vuelo desde disco — así
 * cualquier cambio en la extensión queda disponible al instante en
 * la próxima descarga sin pre-build.
 */
export default function ExtensionDownloadClient() {
  const [version, setVersion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    // Endpoint ligero específico — antes hacíamos un GET con Range:
    // bytes=0-0 al endpoint pesado /download, lo que disparaba la
    // generación del zip aunque cancelásemos. Con /info solo lee el
    // manifest y un stat del dir.
    fetch("/api/v1/extension/info", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.version) setVersion(d.version);
      })
      .catch(() => {});
  }, []);

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      // Usamos fetch + blob en vez de <a download href> directo.
      // El método con anchor "funciona" silenciosamente: si el server
      // devuelve un error JSON o un 500, el browser descarta la
      // respuesta sin avisar al user. Con fetch detectamos el error
      // y lo mostramos en pantalla.
      const r = await fetch("/api/v1/extension/download", {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = j?.error?.message ?? j?.message ?? msg;
        } catch {
          const t = await r.text().catch(() => "");
          if (t) msg = t.slice(0, 300);
        }
        throw new Error(msg);
      }
      const blob = await r.blob();
      // Pedimos el nombre del header Content-Disposition, fallback a
      // un nombre estable con la versión.
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] ?? `hub-extension-v${version ?? "0.0.0"}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Liberamos el blob URL en el siguiente tick (Chrome necesita
      // tiempo para iniciar la descarga antes de revocarlo).
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      setDownloadError(e?.message ?? "Error desconocido al descargar");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Extensión de Chrome — Hub Negocio Vivo</h1>
        <p className="text-sm text-slate-600 mt-1">
          Graba reuniones automáticamente y recibe avisos de alarmas y menciones
          sin abrir el Hub. Instalación manual en cada navegador (no está en la
          Chrome Web Store).
        </p>
      </div>

      {/* Card de descarga */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-white/15 backdrop-blur grid place-items-center text-3xl shrink-0">
            ⏺
          </div>
          <div className="flex-1">
            <div className="text-sm opacity-80 mb-1">
              Hub Reuniones {version ? `· v${version}` : ""}
            </div>
            <div className="text-lg font-semibold mb-3">
              Extensión oficial para tu navegador
            </div>
            <button
              onClick={download}
              disabled={downloading}
              className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-slate-100 font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descargar .zip
            </button>
            <div className="text-xs opacity-80 mt-2">
              El archivo es un .zip de unos 50 KB. Se descarga firmado
              automáticamente con tu sesión.
            </div>
            {downloadError && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-rose-100/90 text-rose-900 text-xs">
                <div className="font-semibold mb-0.5">⚠️ Error al descargar</div>
                <div className="font-mono break-words">{downloadError}</div>
                <div className="opacity-75 mt-1">
                  Si necesitas más detalle abre{" "}
                  <a
                    href="/api/v1/extension/download?debug=1"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    /api/v1/extension/download?debug=1
                  </a>{" "}
                  y pásame el JSON.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pasos de instalación */}
      <Section title="Instalar en 4 pasos">
        <ol className="space-y-3 text-sm">
          <Step n={1} title="Descarga el .zip">
            Pulsa el botón <strong>"Descargar .zip"</strong> de arriba. Te bajas el archivo
            <code className="bg-slate-100 px-1 mx-1 rounded text-[11px]">hub-extension-v{version ?? "X.Y"}.zip</code>.
          </Step>
          <Step n={2} title="Descomprímelo">
            Doble click sobre el .zip. Obtienes una carpeta
            <code className="bg-slate-100 px-1 mx-1 rounded text-[11px]">chrome-extension/</code>. Déjala
            en una ubicación estable (Documentos, Escritorio…) — Chrome la lee desde
            ahí cada vez que arranca, NO la borres luego.
          </Step>
          <Step n={3} title="Cárgala en Chrome">
            Abre{" "}
            <button
              onClick={() => {
                navigator.clipboard.writeText("chrome://extensions").catch(() => {});
              }}
              className="font-mono bg-slate-100 hover:bg-slate-200 px-1.5 rounded text-[11px] inline-flex items-center gap-1"
              title="Copiar al portapapeles"
            >
              chrome://extensions
              <Copy className="h-3 w-3" />
            </button>
            {" "}(no se puede abrir desde un link normal, tienes que pegar la URL en la
            barra). Activa <strong>"Modo de desarrollador"</strong> arriba a la derecha y
            pulsa <strong>"Cargar extensión sin empaquetar"</strong>. Selecciona la carpeta
            que descomprimiste.
          </Step>
          <Step n={4} title="Inicia sesión">
            Pulsa el icono de la extensión (puzzle 🧩 → fíjala con el pin para
            tenerla siempre visible). Introduce tu <strong>email y contraseña</strong>{" "}
            del Hub. Si tienes 2FA activado, te pide el código. La sesión dura 90 días.
          </Step>
        </ol>
      </Section>

      {/* Qué hace */}
      <Section title="¿Qué hace la extensión?">
        <div className="grid sm:grid-cols-2 gap-3">
          <Feature
            icon={<Mic className="h-5 w-5" />}
            title="Graba reuniones"
            text="Detecta cuando abres Meet, Teams, Zoom, Whereby, Jitsi, Webex o GoToMeeting y captura el audio de la pestaña con un click. Whisper transcribe y Claude genera una tarea con resumen, participantes, decisiones y acciones pendientes."
          />
          <Feature
            icon={<Bell className="h-5 w-5" />}
            title="Avisos al instante"
            text="Notificaciones nativas del SO cuando te mencionan, asignan tareas o se acerca el plazo de una tarea con fecha y hora. Las de alarma no se cierran solas hasta que las clicas."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Login con tu cuenta"
            text="Usa el mismo email/contraseña del Hub. Compatible con 2FA. La sesión dura 90 días y es revocable desde /admin/api-keys (busca llaves que empiecen por 'extension:')."
          />
          <Feature
            icon={<Download className="h-5 w-5" />}
            title="Actualización manual"
            text="Cuando publiquemos una versión nueva, vuelves a descargar el .zip y reemplazas la carpeta. Chrome lo detecta y recarga la extensión automáticamente."
          />
        </div>
      </Section>

      <Section title="Plataformas soportadas">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {[
            ["Google Meet", true],
            ["Microsoft Teams (web)", true],
            ["Zoom (web client)", true],
            ["Whereby", true],
            ["Jitsi Meet", true],
            ["Webex (web)", true],
            ["GoToMeeting (web)", true],
            ["Zoom desktop", false],
            ["Teams desktop", false]
          ].map(([name, ok]) => (
            <div
              key={String(name)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              }`}
            >
              {ok ? <CheckCircle2 className="h-4 w-4 inline mr-1.5" /> : <span className="mr-1.5">✕</span>}
              {name}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Las apps de escritorio nativas (Zoom desktop, Teams desktop) no se pueden
          grabar — usa la versión web abriendo la reunión en una pestaña.
        </p>
      </Section>

      <Section title="Privacidad y RGPD">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-2">
          <p>
            <strong>Esta extensión graba audio de las reuniones.</strong> Antes de
            empezar a grabar:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Avisa a todos los participantes de la reunión.</li>
            <li>Explica el fin (resumen interno automatizado en Hub).</li>
            <li>Pide consentimiento explícito.</li>
          </ul>
          <p>
            La transcripción se guarda solo dentro de tu workspace del Hub.
            Nunca se comparte fuera ni se usa para entrenar modelos. Whisper y
            Claude no retienen los audios procesados.
          </p>
        </div>
      </Section>

      <div className="text-xs text-slate-500 pt-4 border-t">
        ¿Problemas para instalar? Consulta el
        <a
          href="/api/v1/extension/download?readme=1"
          className="text-brand-600 underline ml-1"
        >
          README completo
        </a>{" "}
        dentro del .zip o pregunta a soporte.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-slate-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <div className="h-7 w-7 rounded-full bg-brand-600 text-white grid place-items-center text-xs font-bold shrink-0">
        {n}
      </div>
      <div>
        <div className="font-medium text-slate-900 mb-0.5">{title}</div>
        <div className="text-slate-600">{children}</div>
      </div>
    </li>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-2 text-brand-700 font-medium mb-1">
        {icon}
        <span>{title}</span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
    </div>
  );
}
