/**
 * Cliente GitHub REST minimal para self-healing.
 *
 * Funciones que necesita el agente de auto-fix:
 *   - readFile / listDir: para investigar el código antes de proponer fix
 *   - applyPatch: crear branch + commitear varios archivos + abrir PR +
 *     opcionalmente auto-mergear
 *
 * Auth: env GITHUB_SELF_HEAL_TOKEN (PAT con scope `repo`) + env
 * GITHUB_SELF_HEAL_REPO (formato "owner/repo", ej. "tunegociovivo-bit/claude").
 * Si no están seteadas, todas las funciones tiran error explícito —
 * el flow de self-heal queda inactivo sin romper Sonia.
 */

const BASE = "https://api.github.com";

function getConfig(): { token: string; owner: string; repo: string; defaultBranch: string } {
  const token = process.env.GITHUB_SELF_HEAL_TOKEN;
  const fullRepo = process.env.GITHUB_SELF_HEAL_REPO;
  if (!token) throw new Error("GITHUB_SELF_HEAL_TOKEN no configurado en env");
  if (!fullRepo) throw new Error("GITHUB_SELF_HEAL_REPO no configurado en env (formato owner/repo)");
  const [owner, repo] = fullRepo.split("/");
  if (!owner || !repo) throw new Error("GITHUB_SELF_HEAL_REPO formato inválido");
  const defaultBranch = process.env.GITHUB_SELF_HEAL_BRANCH || "claude/internal-project-platform-ZezvX";
  return { token, owner, repo, defaultBranch };
}

async function ghFetch<T = any>(
  path: string,
  init: RequestInit = {},
  expectJson: boolean = true
): Promise<T> {
  const cfg = getConfig();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub ${r.status} ${path}: ${txt.slice(0, 400)}`);
  }
  if (!expectJson) return null as T;
  return (await r.json()) as T;
}

/**
 * Lee un archivo del repo en la branch indicada (o default si omitida).
 * Devuelve { content, sha }. content como UTF-8 (sin base64).
 */
export async function readRepoFile(
  path: string,
  branch?: string
): Promise<{ content: string; sha: string; size: number } | null> {
  const cfg = getConfig();
  const ref = branch || cfg.defaultBranch;
  try {
    const data = await ghFetch<any>(
      `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
    );
    if (data.type !== "file") return null;
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha, size: data.size };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("404")) return null;
    throw e;
  }
}

/**
 * Lista contenidos de un directorio. Devuelve array de { path, type,
 * size }. Para grep / discovery rápido.
 */
export async function listRepoDir(
  path: string,
  branch?: string
): Promise<Array<{ path: string; type: "file" | "dir"; size: number }>> {
  const cfg = getConfig();
  const ref = branch || cfg.defaultBranch;
  const data = await ghFetch<any[]>(
    `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
  );
  return data.map((d: any) => ({
    path: d.path,
    type: d.type === "dir" ? "dir" : "file",
    size: d.size ?? 0
  }));
}

/**
 * Búsqueda code-search por keyword. Devuelve max 30 matches con path
 * + score. Útil para localizar el archivo correcto a partir de un
 * mensaje de error que mencione una función o clase.
 */
export async function searchRepoCode(
  query: string
): Promise<Array<{ path: string; matches: number }>> {
  const cfg = getConfig();
  const q = `${query} repo:${cfg.owner}/${cfg.repo}`;
  const data = await ghFetch<any>(
    `/search/code?q=${encodeURIComponent(q)}&per_page=30`
  );
  return (data.items ?? []).map((it: any) => ({
    path: it.path,
    matches: it.score ?? 1
  }));
}

/**
 * Crea una branch nueva desde la default branch.
 */
export async function createBranch(branchName: string): Promise<{ ref: string; sha: string }> {
  const cfg = getConfig();
  // Get SHA de la default branch
  const defRef = await ghFetch<any>(
    `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.defaultBranch)}`
  );
  const baseSha = defRef.object.sha;
  // Crea la ref
  const newRef = await ghFetch<any>(`/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    })
  });
  return { ref: newRef.ref, sha: baseSha };
}

/**
 * Actualiza (o crea) un archivo en una branch específica. content en
 * UTF-8; lo codificamos a base64 antes de mandarlo.
 */
export async function writeRepoFile(opts: {
  path: string;
  content: string;
  message: string;
  branch: string;
  /** Si el archivo ya existe, su SHA actual. Requerido para update. */
  sha?: string;
}): Promise<{ commitSha: string }> {
  const cfg = getConfig();
  const body: any = {
    message: opts.message,
    content: Buffer.from(opts.content, "utf-8").toString("base64"),
    branch: opts.branch
  };
  if (opts.sha) body.sha = opts.sha;
  const data = await ghFetch<any>(
    `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(opts.path)}`,
    {
      method: "PUT",
      body: JSON.stringify(body)
    }
  );
  return { commitSha: data.commit.sha };
}

/**
 * Abre una pull request de branch → default branch.
 */
export async function openPullRequest(opts: {
  branch: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const cfg = getConfig();
  const data = await ghFetch<any>(
    `/repos/${cfg.owner}/${cfg.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.branch,
        base: cfg.defaultBranch
      })
    }
  );
  return { url: data.html_url, number: data.number };
}

/**
 * Merge de una PR. mergeMethod por defecto "squash" — historial limpio.
 */
export async function mergePullRequest(opts: {
  number: number;
  mergeMethod?: "merge" | "squash" | "rebase";
  commitMessage?: string;
}): Promise<{ merged: boolean; sha: string }> {
  const cfg = getConfig();
  const data = await ghFetch<any>(
    `/repos/${cfg.owner}/${cfg.repo}/pulls/${opts.number}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        merge_method: opts.mergeMethod ?? "squash",
        commit_message: opts.commitMessage
      })
    }
  );
  return { merged: !!data.merged, sha: data.sha };
}

export function getRepoConfig() {
  return getConfig();
}
