"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, MessageSquare, Send } from "lucide-react";

type Decision = { id: string; decision: string; comment: string | null; createdAt: string };
type Post = {
  id: string;
  title: string;
  content: string | null;
  hashtags: string | null;
  firstComment: string | null;
  copyByNetwork: Record<string, string> | null;
  format: string | null;
  networks: string;
  thumbnail: string | null;
  mediaUrls: string;
  status: string;
  scheduledFor: string | null;
  decisions: Decision[];
};
type Data = {
  workspace: { name: string; logoUrl: string | null };
  client: { id: string; name: string; brandColorPrimary: string; brandColorAccent: string; logoUrl: string | null } | null;
  month: string;
  expiresAt: string | null;
  posts: Post[];
};

export default function PublicApprovalView({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const r = await fetch(`/api/public/approval/${token}`, { cache: "no-store" });
    if (!r.ok) {
      setError(r.status === 404 ? "Este enlace no es válido o ha caducado." : `Error ${r.status}`);
      setLoading(false);
      return;
    }
    setData(await r.json());
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-semibold mb-2">Enlace no disponible</h1>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const primary = data.client?.brandColorPrimary ?? "#1F2937";
  const accent = data.client?.brandColorAccent ?? "#2563EB";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-10" style={{ borderBottomColor: primary + "33" }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          {data.client?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.client.logoUrl} alt={data.client.name} className="h-9 w-auto" />
          ) : (
            <div
              className="h-9 w-9 rounded-md flex items-center justify-center text-white font-semibold"
              style={{ backgroundColor: primary }}
            >
              {data.client?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{data.client?.name ?? ""}</h1>
            <p className="text-xs text-slate-500">Calendario editorial · {data.month}</p>
          </div>
          <span className="hidden sm:inline-flex text-[11px] text-slate-500">por {data.workspace.name}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="text-sm font-semibold mb-1">Hola 👋</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Estas son las publicaciones que hemos preparado para tu marca este mes. Pulsa{" "}
            <span className="font-medium text-emerald-700">Aprobar</span> en cada una que te guste o deja un{" "}
            <span className="font-medium text-slate-700">comentario</span> si quieres cambios. Tus decisiones nos llegan en
            tiempo real.
          </p>
        </div>

        <SummaryStats posts={data.posts} accent={accent} />

        {data.posts.length === 0 && (
          <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">
            Aún no hay publicaciones cargadas para {data.month}.
          </div>
        )}

        {data.posts.map((p) => (
          <PostCard key={p.id} post={p} token={token} accent={accent} onChanged={reload} />
        ))}
      </main>
    </div>
  );
}

function SummaryStats({ posts, accent }: { posts: Post[]; accent: string }) {
  const total = posts.length;
  if (total === 0) return null;
  let approved = 0;
  let rejected = 0;
  let comments = 0;
  let pending = 0;
  for (const p of posts) {
    const last = p.decisions[p.decisions.length - 1];
    if (last?.decision === "approved") approved++;
    else if (last?.decision === "rejected") rejected++;
    else pending++;
    comments += p.decisions.filter((d) => d.decision === "comment").length;
  }
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Stat label="Total" value={total} color="text-slate-700" />
        <Stat label="Aprobadas" value={approved} color="text-emerald-700" />
        <Stat label="Cambios pedidos" value={rejected} color="text-rose-700" />
        <Stat label="Pendientes" value={pending} color="text-amber-700" />
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-slate-100 flex">
        {approved > 0 && (
          <div className="bg-emerald-500" style={{ width: `${pct(approved)}%` }} title={`${approved} aprobadas`} />
        )}
        {rejected > 0 && (
          <div className="bg-rose-500" style={{ width: `${pct(rejected)}%` }} title={`${rejected} cambios pedidos`} />
        )}
        {pending > 0 && (
          <div className="bg-amber-300" style={{ width: `${pct(pending)}%` }} title={`${pending} pendientes`} />
        )}
      </div>
      {comments > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">{comments} comentarios dejados en este mes.</p>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function PostCard({
  post,
  token,
  accent,
  onChanged
}: {
  post: Post;
  token: string;
  accent: string;
  onChanged: () => void;
}) {
  const [posting, setPosting] = useState<"approved" | "rejected" | "comment" | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  let images: string[] = [];
  try {
    const parsed = JSON.parse(post.mediaUrls);
    if (Array.isArray(parsed)) images = parsed.filter((u) => typeof u === "string");
  } catch {}
  if (post.thumbnail && !images.includes(post.thumbnail)) images.unshift(post.thumbnail);

  let networks: string[] = [];
  try {
    networks = JSON.parse(post.networks);
  } catch {}

  const lastDecision = post.decisions[post.decisions.length - 1];
  const isApproved = lastDecision?.decision === "approved";
  const isRejected = lastDecision?.decision === "rejected";

  async function send(decision: "approved" | "rejected" | "comment") {
    if (decision === "comment" && !comment.trim()) return;
    setPosting(decision);
    await fetch(`/api/public/approval/${token}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId: post.id,
        decision,
        comment: decision === "comment" ? comment : undefined
      })
    });
    setComment("");
    setShowComment(false);
    setPosting(null);
    onChanged();
  }

  const date = post.scheduledFor ? new Date(post.scheduledFor) : null;

  return (
    <article className="rounded-xl border bg-white overflow-hidden">
      <div className="grid md:grid-cols-[280px_1fr] gap-4 p-4">
        <div>
          {images[0] ? (
            <a href={images[0]} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={images[0]} alt={post.title} className="w-full max-h-[400px] object-contain rounded-lg border bg-slate-50" />
            </a>
          ) : (
            <div className="w-full aspect-square rounded-lg border bg-slate-50 flex items-center justify-center text-slate-400 text-xs">
              Sin imagen
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-base leading-snug">{post.title}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {date && date.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                {post.format && <> · {post.format.toUpperCase()}</>}
              </p>
            </div>
            <div>
              {isApproved && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> Aprobada
                </span>
              )}
              {isRejected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-rose-50 text-rose-700 border border-rose-200">
                  <XCircle className="h-3 w-3" /> Cambios pedidos
                </span>
              )}
            </div>
          </div>

          {networks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {networks.map((n) => (
                <span key={n} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 capitalize">
                  {n}
                </span>
              ))}
            </div>
          )}

          {post.content && (
            <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed bg-slate-50/60 rounded-lg p-3 border">
              {post.content}
            </div>
          )}

          {post.hashtags && (
            <div className="text-xs text-brand-600 break-words">{post.hashtags}</div>
          )}

          {post.decisions.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500">
                {post.decisions.length} interacción{post.decisions.length !== 1 ? "es" : ""} previas
              </summary>
              <div className="mt-1 space-y-1 pl-3 border-l border-slate-200">
                {post.decisions.map((d) => (
                  <div key={d.id} className="text-slate-600">
                    <span className="font-medium">{d.decision === "approved" ? "✓ aprobada" : d.decision === "rejected" ? "✗ rechazada" : "💬 comentario"}</span>
                    {d.comment && <> · {d.comment}</>}
                    <span className="text-slate-400 ml-1">({new Date(d.createdAt).toLocaleString("es-ES")})</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => send("approved")}
              disabled={!!posting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {posting === "approved" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => send("rejected")}
              disabled={!!posting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-rose-50 border-rose-200 text-rose-700 text-xs font-medium disabled:opacity-50"
            >
              {posting === "rejected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              Pedir cambios
            </button>
            <button
              type="button"
              onClick={() => setShowComment((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-slate-700 text-xs"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Comentar
            </button>
          </div>

          {showComment && (
            <div className="flex gap-2 items-start pt-1">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Tu comentario…"
                className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                style={{ "--tw-ring-color": accent } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={() => send("comment")}
                disabled={posting === "comment" || !comment.trim()}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {posting === "comment" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Enviar
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
