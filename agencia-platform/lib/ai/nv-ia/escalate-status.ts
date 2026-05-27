/**
 * Consulta el estado actual de un issue de escalación en GitHub
 * para mostrárselo al user en la UI: si está abierto, si Claude
 * ha comentado, si hay PR linkeado, si está mergeado, etc.
 *
 * Sin esto el user solo ve "🛠 Claude mejorando el sistema" como
 * texto estático y no sabe si Claude ya empezó, está mid-PR, o
 * el GitHub App no llegó a verlo. Con esto la card pasa a:
 *   "🛠 Claude investigando · 2 comentarios · hace 3m"
 *   "🛠 PR #42 abierto · esperando merge"
 *   "🛠 PR mergeado · deploy en marcha — re-procesando en breve"
 *   "⚠ Issue abierto pero sin actividad de Claude desde hace 15m"
 *
 * Cache en memoria 60s por issue para no saturar la API de GitHub
 * (5000 req/h auth → con 60s TTL aguantamos cientos de escalaciones
 * activas en paralelo sin tocar el límite).
 */

import { extractEscalationFromLog } from "./escalate";

const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 60_000;

type IssueStatus = {
  /** Estado del issue en GitHub. */
  state: "investigating" | "pr_open" | "pr_merged" | "closed" | "unknown";
  /** URL del issue. */
  issueUrl: string;
  /** Número del issue (#N). */
  issueNumber: number;
  /** Si hay PR asociado al issue, su URL. */
  prUrl?: string;
  prNumber?: number;
  prState?: "open" | "closed" | "merged";
  /** Timestamp del último evento relevante (comment, PR, close). */
  lastActivityAt?: string;
  /** Quién hizo el último comentario (login de GitHub). */
  lastCommentBy?: string;
  /** Total de comentarios en el issue. */
  commentCount: number;
  /** Mensaje resumido amigable para la UI. */
  humanLabel: string;
  /** Si lleva >15 min sin actividad de Claude. */
  staleWarning?: boolean;
};

type CacheEntry = { at: number; data: IssueStatus | null };
const cache = new Map<string, CacheEntry>();

/**
 * Dado el log de un AiAgentRun (donde está la entrada de escalation),
 * consulta GitHub y devuelve estado o null si no hay escalation o no
 * está configurado.
 */
export async function getEscalationStatus(log: unknown): Promise<IssueStatus | null> {
  const esc = extractEscalationFromLog(log);
  if (!esc) return null;
  return fetchIssueStatus(esc.issueUrl, esc.issueNumber);
}

async function fetchIssueStatus(
  issueUrl: string,
  issueNumber: number
): Promise<IssueStatus | null> {
  const repo = process.env.SONIA_ESCALATION_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    // Sin config no podemos consultar. Devuelve estado "unknown" con
    // el link para que el user al menos pueda abrir el issue.
    return {
      state: "investigating",
      issueUrl,
      issueNumber,
      commentCount: 0,
      humanLabel: "Claude investigando (sin acceso al estado en vivo — abrir issue para detalle)"
    };
  }

  const cacheKey = `${repo}#${issueNumber}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json"
    };
    // 1) Issue básico.
    const issueResp = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, { headers });
    if (!issueResp.ok) {
      cache.set(cacheKey, { at: Date.now(), data: null });
      return null;
    }
    const issue: any = await issueResp.json();

    // 2) Comments para detectar último actor.
    const commentsResp = await fetch(
      `${GITHUB_API}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      { headers }
    );
    const comments: any[] = commentsResp.ok ? await commentsResp.json() : [];
    const lastComment = comments[comments.length - 1];

    // 3) Detectar PR linkado vía timeline (cross-references).
    const timelineResp = await fetch(
      `${GITHUB_API}/repos/${repo}/issues/${issueNumber}/timeline?per_page=100`,
      { headers: { ...headers, Accept: "application/vnd.github.mockingbird-preview+json" } }
    );
    const timeline: any[] = timelineResp.ok ? await timelineResp.json() : [];
    let prUrl: string | undefined;
    let prNumber: number | undefined;
    let prState: IssueStatus["prState"];
    for (const ev of timeline) {
      if (ev.event === "cross-referenced" && ev.source?.issue?.pull_request) {
        const pr = ev.source.issue;
        prUrl = pr.html_url;
        prNumber = pr.number;
        // Es PR — el estado puede ser open / closed (incluye merged).
        prState = pr.state === "closed"
          ? (pr.pull_request?.merged_at ? "merged" : "closed")
          : "open";
      }
    }

    // 4) Si no detectamos PR via timeline, intento más directo via search.
    if (!prUrl) {
      try {
        const searchUrl = `${GITHUB_API}/search/issues?q=${encodeURIComponent(
          `repo:${repo} is:pr "#${issueNumber}" in:body,title`
        )}`;
        const sr = await fetch(searchUrl, { headers });
        if (sr.ok) {
          const sdata: any = await sr.json();
          const hit = sdata.items?.[0];
          if (hit) {
            prUrl = hit.html_url;
            prNumber = hit.number;
            if (hit.state === "closed") {
              // Necesitamos saber si fue merged — pedimos detalle.
              try {
                const prResp = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${hit.number}`, { headers });
                if (prResp.ok) {
                  const prData: any = await prResp.json();
                  prState = prData.merged ? "merged" : "closed";
                }
              } catch {}
            } else {
              prState = "open";
            }
          }
        }
      } catch {}
    }

    // 5) Determinar state global.
    let state: IssueStatus["state"];
    if (issue.state === "closed") {
      state = prState === "merged" ? "pr_merged" : "closed";
    } else if (prState === "open") {
      state = "pr_open";
    } else if (prState === "merged") {
      state = "pr_merged";
    } else {
      state = "investigating";
    }

    const lastActivityAt = lastComment?.created_at ?? issue.updated_at ?? issue.created_at;
    const lastCommentBy = lastComment?.user?.login;
    const claudeActorPatterns = /^(claude|github-actions|coderabbitai)/i;
    const claudeHasActed =
      (lastComment && claudeActorPatterns.test(lastCommentBy ?? "")) || !!prUrl;
    const minutesSinceActivity =
      (Date.now() - new Date(lastActivityAt).getTime()) / 60_000;
    const staleWarning =
      state === "investigating" && !claudeHasActed && minutesSinceActivity > 15;

    // 6) Construir label amigable.
    let humanLabel: string;
    const minsAgo = Math.floor(minutesSinceActivity);
    const timeStr =
      minsAgo < 1 ? "hace <1m" : minsAgo < 60 ? `hace ${minsAgo}m` : `hace ${Math.floor(minsAgo / 60)}h`;
    if (state === "pr_merged") {
      humanLabel = `PR #${prNumber} mergeado · deploy en marcha · re-procesará`;
    } else if (state === "pr_open") {
      humanLabel = `PR #${prNumber} abierto · esperando merge · ${timeStr}`;
    } else if (state === "closed") {
      humanLabel = `Issue cerrado sin PR · ${timeStr}`;
    } else if (staleWarning) {
      humanLabel = `⚠ Claude sin actividad ${timeStr} — revisar GitHub App`;
    } else if (comments.length === 0) {
      humanLabel = `Claude investigando · sin actividad aún · ${timeStr}`;
    } else {
      humanLabel = `Claude investigando · ${comments.length} comentario(s) · último ${timeStr}`;
    }

    const data: IssueStatus = {
      state,
      issueUrl,
      issueNumber,
      prUrl,
      prNumber,
      prState,
      lastActivityAt,
      lastCommentBy,
      commentCount: comments.length,
      humanLabel,
      staleWarning
    };
    cache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.warn("[escalate-status] fetch error:", (e as Error).message);
    cache.set(cacheKey, { at: Date.now(), data: null });
    return null;
  }
}
