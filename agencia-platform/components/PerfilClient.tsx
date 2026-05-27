"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import PageHeader from "@/components/PageHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import ExternalCalendarsSection from "@/components/ExternalCalendarsSection";
import GoogleCalendarSection from "@/components/GoogleCalendarSection";
import { Loader2, Save, LogOut, Mail, ChevronRight } from "lucide-react";

type Me = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  phone: string | null;
};

export default function PerfilClient() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [image, setImage] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/me");
    if (r.ok) {
      const d = await r.json();
      if (d.user) {
        setMe(d.user);
        setName(d.user.name ?? "");
        setPhone(d.user.phone ?? "");
        setImage(d.user.image ?? "");
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const payload: any = {
      name,
      phone: phone || null,
      image: image || null
    };
    if (password) {
      if (password.length < 8) {
        setError("La contraseña debe tener al menos 8 caracteres");
        setSaving(false);
        return;
      }
      payload.password = password;
    }
    const r = await fetch("/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setSavedAt(new Date());
    setPassword("");
    load();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Mi perfil" description="Edita tu nombre, foto, teléfono y contraseña." />

      <div className="mb-4">
        <a
          href="/admin/personalizar"
          className="inline-flex items-center gap-2 text-sm text-brand-700 hover:text-brand-800 hover:underline"
        >
          Personalizar mi menú lateral →
        </a>
      </div>

      {loading || !me ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <form onSubmit={save} className="bg-white rounded-xl border p-5 space-y-5">
          <ImageUpload
            value={image}
            onChange={setImage}
            targetType="USER"
            targetId={me.id}
            shape="circle"
            size={72}
            label="Foto de perfil"
          />

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input
              value={me.email}
              disabled
              className="w-full px-3 py-2 rounded-lg border bg-slate-50 text-sm text-slate-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Solo un admin puede cambiar tu email desde /admin/usuarios.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Teléfono <span className="text-slate-400 font-normal">(para futuras notificaciones SMS/WhatsApp)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+34 6XX XXX XXX"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Cambiar contraseña <span className="text-slate-400 font-normal">(dejar vacía si no quieres cambiarla)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-xs">
              {savedAt && <span className="text-emerald-700">✓ Guardado a las {savedAt.toLocaleTimeString("es-ES")}</span>}
              {error && <span className="text-rose-600">{error}</span>}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </button>
          </div>
        </form>
      )}

      {/* Mi correo (IMAP/SMTP personal — cada trabajador conecta el suyo) */}
      <Link
        href="/perfil/correo"
        className="bg-white rounded-xl border p-5 mt-6 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-brand-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Mi correo</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Conecta tu cuenta (IMAP/SMTP) para que Sonia pueda consultar y enviar tus emails cuando se lo
              pidas. Privado: solo tú lo usas desde tu sesión.
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
      </Link>

      {/* Google Calendar (OAuth bidireccional) */}
      <GoogleCalendarSection />

      {/* Calendarios externos vinculados read-only por URL iCal */}
      <ExternalCalendarsSection />

      {/* Cerrar sesión */}
      <div className="bg-white rounded-xl border p-5 mt-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Cerrar sesión</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Tendrás que volver a iniciar sesión la próxima vez que entres a la plataforma.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Cerrar sesión?")) signOut({ callbackUrl: "/login" });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-sm font-medium"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
