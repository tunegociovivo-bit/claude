"use client";

import { useEffect, useState } from "react";
import EditorialMetaConnection from "@/components/editorial/EditorialMetaConnection";

function parseMediaUrls(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    const values = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    // CRM: base para URLs relativas (/api/files/...).
    return [...new Map(values.map((url) => { const parsedUrl = new URL(url, "http://local.invalid"); return [`${parsedUrl.origin}${parsedUrl.pathname}`, url]; })).values()];
  } catch {
    return [];
  }
}

type Profile = { id: string; label: string; active: boolean; facebookPageId: string | null; instagramUserId: string | null; facebookPageName: string | null; instagramName: string | null; metaConnection?: { expiresAt: string | null } | null };
type Publication = { id: string; network: string; status: string; profileId?: string | null; externalUrl?: string | null; lastError?: string | null; publishedAt?: string | null; scheduledFor?: string | null };
const labels: Record<string, string> = { DRAFT: "Borrador", REVIEW: "Pendiente de aprobación", PENDING: "Preparada", SCHEDULED: "Programada", PUBLISHING: "Publicando", PUBLISHED: "Publicada", FAILED: "Error", CANCELLED: "Cancelada", UNKNOWN: "Revisar en Meta antes de reintentar" };

/**
 * Publicar / programar una publicación en Facebook e Instagram. Portado del
 * Hub: en el CRM no hay OAuth ni perfiles por cliente; las cuentas vinculadas
 * son las de la marca del negocio y la conexión (token) se gestiona aquí mismo.
 */
export function EditorialMetaPanel({ post, onChanged }: { post: { id: string; clientId?: string | null; status: string; scheduledFor?: string | null; networks?: string | null; publications?: Publication[]; mediaUrls?: string | null; format?: string | null }; onChanged: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [media, setMedia] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showConnection, setShowConnection] = useState(false);
  const button = "rounded border bg-white px-3 py-1.5 text-xs disabled:opacity-40";
  async function request(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "No se pudo completar la operación.");
    return data;
  }
  async function load() {
    const data = await request("/api/v1/editorial/meta-profiles");
    setProfiles(data.items || []);
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [post.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Error de conexión"); }
    finally { setBusy(false); }
  }
  async function publish(schedule: boolean) {
    const destinations = profiles.map((profile) => ({ profileId: profile.id, networks: ["facebook", "instagram"].filter((network) => selected.includes(`${profile.id}:${network}`)) })).filter((destination) => destination.networks.length);
    const data = await request(`/api/v1/editorial/posts/${post.id}/publish-meta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinations, schedule, publishNow: !schedule, mediaUrls: media }) });
    setMessage(data.errors?.length ? data.errors.map((error: { message: string }) => error.message).join(" · ") : schedule ? "Destinos programados." : "Consulta el estado de cada canal debajo.");
    onChanged();
  }
  const approved = ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(post.status);
  const visibleProfiles = profiles.filter((profile) => profile.active || post.publications?.some((publication) => publication.profileId === profile.id));
  return <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Publicar en Facebook e Instagram</h3>
      <button type="button" className={button} onClick={() => setShowConnection((value) => !value)}>
        {showConnection ? "Ocultar conexión" : profiles.some((profile) => profile.active) ? "Conexión con Meta" : "Conectar Facebook / Instagram"}
      </button>
    </div>
    {showConnection && <div className="rounded-lg border bg-white p-3"><EditorialMetaConnection onChanged={() => { void load(); onChanged(); }} /></div>}
    {visibleProfiles.length > 3 && <input aria-label="Buscar cuentas Meta" className="w-full rounded border px-2 py-1 text-xs" placeholder="Buscar página o Instagram…" value={search} onChange={(event) => setSearch(event.target.value)} />}
    {visibleProfiles.filter((profile) => `${profile.label} ${profile.facebookPageName} ${profile.instagramName}`.toLowerCase().includes(search.toLowerCase())).map((profile) => {
      const expired = !!profile.metaConnection?.expiresAt && new Date(profile.metaConnection.expiresAt) <= new Date();
      const available = profile.active && !!profile.metaConnection && !expired;
      return <div key={profile.id} className="rounded border bg-white p-2 text-xs space-y-2">
        <div className="flex justify-between gap-2"><span>{profile.label} · {available ? "Activa" : expired ? "Caducada: pega un token nuevo" : "Desconectada"}</span></div>
        <div className="flex flex-wrap gap-3">{(["facebook", "instagram"] as const).filter((network) => network === "facebook" ? profile.facebookPageId : profile.instagramUserId).map((network) => <label key={network} className="inline-flex items-center gap-1"><input type="checkbox" disabled={!available || busy} checked={selected.includes(`${profile.id}:${network}`)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, `${profile.id}:${network}`] : value.filter((key) => key !== `${profile.id}:${network}`))} /> {network === "facebook" ? profile.facebookPageName || "Facebook" : `Instagram ${profile.instagramName ? `@${profile.instagramName}` : ""}`}</label>)}</div>
      </div>;
    })}
    {!profiles.some((profile) => profile.active) && <p className="text-xs">Tu marca aún no tiene ninguna página vinculada. Pulsa «Conectar Facebook / Instagram».</p>}
    {["carrusel", "carousel"].includes(post.format || "") && <fieldset className="rounded border p-2"><legend className="text-xs">Imágenes del carrusel (2–10, en orden de selección)</legend><div className="flex flex-wrap gap-2">{parseMediaUrls(post.mediaUrls).filter((url) => !/\.mp4(?:\?|$)/i.test(url)).map((url) => <label key={url} className="text-xs">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={url} alt="Imagen disponible" className="h-16 w-16 object-cover" /><input type="checkbox" checked={media.includes(url)} disabled={!media.includes(url) && media.length >= 10} onChange={(event) => setMedia((values) => event.target.checked ? [...values, url] : values.filter((value) => value !== url))} />{media.includes(url) ? ` ${media.indexOf(url) + 1}` : " Elegir"}</label>)}</div></fieldset>}
    {!approved && <p className="text-xs">Estado: {labels[post.status] || post.status}. Aprueba la publicación para enviarla a Meta.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !selected.length || !approved} onClick={() => run(() => publish(false))}>Publicar ahora / reintentar</button><button type="button" className={button} disabled={busy || !selected.length || !approved || !post.scheduledFor} onClick={() => run(() => publish(true))}>Programar</button></div>
    {post.publications?.map((publication) => <div key={publication.id} className="border-t pt-2 text-xs"><span>{profiles.find((profile) => profile.id === publication.profileId)?.label || "Cuenta Meta"} · {publication.network} · {labels[publication.status] || publication.status}</span>{(publication.publishedAt || publication.scheduledFor) && <time className="ml-2">{new Date(publication.publishedAt || publication.scheduledFor!).toLocaleString("es-ES")}</time>}{publication.externalUrl && <a className="ml-2 underline" href={publication.externalUrl} target="_blank" rel="noreferrer">Ver publicación</a>}{publication.lastError && <p className="text-rose-700">{publication.lastError}</p>}</div>)}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
