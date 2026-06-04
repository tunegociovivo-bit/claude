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

// Defaults sensatos para esta instancia. Apuntan al repo donde vive
// el código. El usuario puede sobreescribir en
// Workspace.settings.integrations.selfHeal.{ repo, branch } si quiere
// que el agente parchee otro repo.
const DEFAULT_REPO = "tunegociovivo-bit/claude";
// IMPORTANTE: debe ser la rama que Railway despliega de verdad. Si el
// self-heal apunta a otra, sus PRs se mergean pero NUNCA se despliegan y la
// tarea entra en bucle (auto-fix → no deploy → mismo error → auto-fix…).
const DEFAULT_BRANCH = "claude/wordpress-ai-review-plugin-bdSLe";

type SelfHealConfig = {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
};

/**
 * Lee config del workspace primero (cifrada en BD), env como fallback.
 * Sin workspaceId, solo env. Si falta token en ambos, error claro.
 */
async function getConfigAsync(workspaceId?: string | null): Promise<SelfHealConfig> {
  let token: string | undefined;
  let fullRepo: string | undefined;
  let branch: string | undefined;

  if (workspaceId) {
    try {
      const { prisma } = await import("@/lib/db/prisma");
      const { decryptSecret } = await import("@/lib/ai/crypto");
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true }
      });
      const cfg = (ws?.settings as any)?.integrations?.selfHeal;
      if (cfg?.tokenEnc) {
        const decoded = decryptSecret(cfg.tokenEnc);
        if (decoded) token = decoded;
      }
      if (typeof cfg?.repo === "string") fullRepo = cfg.repo;
      if (typeof cfg?.branch === "string") branch = cfg.branch;
    } catch {
      // si el lookup falla, caemos a env
    }
  }

  token = token ?? process.env.GITHUB_SELF_HEAL_TOKEN;
  fullRepo = fullRepo ?? process.env.GITHUB_SELF_HEAL_REPO ?? DEFAULT_REPO;
  branch = branch ?? process.env.GITHUB_SELF_HEAL_BRANCH ?? DEFAULT_BRANCH;

  if (!token) {
    throw new Error(
      "Self-heal sin configurar. Pega el PAT de GitHub en /admin/sonia-self-heal o setea GITHUB_SELF_HEAL_TOKEN en env."
    );
  }
  const [owner, repo] = fullRepo.split("/");
  if (!owner || !repo) {
    throw new Error(`Repo inválido: ${fullRepo}. Formato esperado owner/repo.`);
  }
  return { token, owner, repo, defaultBranch: branch };
}

// Cache module-level de la config última usada — útil cuando un
// caller llama múltiples veces seguidas sin pasar workspaceId.
let lastUsedConfig: SelfHealConfig | null = null;
function getConfig(): SelfHealConfig {
  if (lastUsedConfig) return lastUsedConfig;
  // Fallback puro a env (sin workspaceId)
  const token = process.env.GITHUB_SELF_HEAL_TOKEN;
  if (!token) {
    throw new Error(
      "Self-heal sin configurar y sin contexto de workspace. Configura en /admin/sonia-self-heal."
    );
  }
  const fullRepo = process.env.GITHUB_SELF_HEAL_REPO ?? DEFAULT_REPO;
  const branch = process.env.GITHUB_SELF_HEAL_BRANCH ?? DEFAULT_BRANCH;
  const [owner, repo] = fullRepo.split("/");
  lastUsedConfig = { token, owner, repo, defaultBranch: branch };
  return lastUsedConfig;
}

/** Caller con workspaceId — versión preferida. */
export async function loadRepoConfigForWorkspace(
  workspaceId: string
): Promise<SelfHealConfig> {
  const cfg = await getConfigAsync(workspaceId);
  lastUsedConfig = cfg; // las llamadas subsecuentes sync usan ésta
  return cfg;
}

/** Devuelve si self-heal está configurado para este workspace (DB o env). */
export async function isSelfHealConfigured(workspaceId?: string | null): Promise<boolean> {
  try {
    await getConfigAsync(workspaceId);
    return true;
  } catch {
    return false;
  }
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

/**
 * Estado de los check runs del último commit de una PR.
 * Devuelve resumen + lista detallada.
 */
export async function getPullRequestChecks(prNumber: number): Promise<{
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  pending: number;
  allOk: boolean;
  noChecks: boolean;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
}> {
  const cfg = getConfig();
  // Último commit de la PR
  const commits = await ghFetch<any[]>(
    `/repos/${cfg.owner}/${cfg.repo}/pulls/${prNumber}/commits?per_page=100`
  );
  const lastSha = commits[commits.length - 1]?.sha;
  if (!lastSha) {
    return {
      total: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      allOk: false,
      noChecks: true,
      checks: []
    };
  }
  const data = await ghFetch<any>(
    `/repos/${cfg.owner}/${cfg.repo}/commits/${lastSha}/check-runs`
  );
  const runs = (data.check_runs ?? []) as any[];
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let pending = 0;
  for (const r of runs) {
    if (r.status === "completed") {
      completed++;
      if (r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped") {
        succeeded++;
      } else {
        failed++;
      }
    } else {
      pending++;
    }
  }
  return {
    total: runs.length,
    completed,
    succeeded,
    failed,
    pending,
    allOk: runs.length > 0 && failed === 0 && pending === 0,
    noChecks: runs.length === 0,
    checks: runs.map((r: any) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion ?? null
    }))
  };
}

/**
 * Revierte un commit creando una nueva PR con el revert. Útil cuando
 * un merge auto-healed rompe el deploy.
 *
 * Usa GitHub API revert: en realidad creamos un commit nuevo en una
 * branch que aplique los cambios inversos del commit original. Como
 * la API REST de GitHub no expone revert directo, hacemos:
 *   1. Lee el diff del commit a revertir
 *   2. Crea branch nueva desde HEAD
 *   3. Lee los archivos en su estado PRE-commit (vía git tree del
 *      commit padre)
 *   4. Escribe esos archivos en la branch nueva
 *   5. Abre PR
 *
 * Esta función NO es trivial — si falla, devuelve error y deja
 * un comentario en el commit indicando la necesidad de revert
 * manual.
 */
export async function revertCommit(opts: {
  commitSha: string;
  reason: string;
}): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
  try {
    const cfg = getConfig();
    // Lee el commit con sus cambios
    const commit = await ghFetch<any>(
      `/repos/${cfg.owner}/${cfg.repo}/commits/${opts.commitSha}`
    );
    const parentSha = commit.parents?.[0]?.sha;
    if (!parentSha) {
      return { ok: false, error: "No se pudo encontrar commit padre para revertir" };
    }
    const branchName = `claude/revert-${opts.commitSha.slice(0, 7)}-${Date.now().toString(36)}`;
    await createBranch(branchName);

    // Para cada archivo cambiado en el commit, lo restauramos a su
    // versión del padre (= revert)
    const files = (commit.files ?? []) as any[];
    for (const f of files) {
      if (f.status === "added") {
        // Archivo añadido por el commit → borrar en revert
        try {
          const current = await readRepoFile(f.filename, branchName);
          if (current) {
            await ghFetch(
              `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(f.filename)}`,
              {
                method: "DELETE",
                body: JSON.stringify({
                  message: `revert: borrar ${f.filename}`,
                  sha: current.sha,
                  branch: branchName
                })
              }
            );
          }
        } catch {}
      } else {
        // Lee la versión del padre y la escribe en la nueva branch
        const parentFile = await readRepoFile(f.filename, parentSha);
        if (parentFile) {
          const currentInBranch = await readRepoFile(f.filename, branchName);
          await writeRepoFile({
            path: f.filename,
            content: parentFile.content,
            message: `revert: restaurar ${f.filename} a ${parentSha.slice(0, 7)}`,
            branch: branchName,
            sha: currentInBranch?.sha
          });
        }
      }
    }

    const pr = await openPullRequest({
      branch: branchName,
      title: `🔙 Revert ${commit.sha.slice(0, 7)}: ${commit.commit?.message?.split("\n")[0] ?? "fix"}`,
      body:
        `Auto-revert disparado por el watchdog post-merge.\n\n` +
        `**Motivo:** ${opts.reason}\n\n` +
        `**Commit revertido:** ${commit.sha}\n` +
        `**Archivos afectados:** ${files.length}\n\n` +
        `Mergea esta PR para restaurar el estado anterior. Después investiga por qué el fix anterior rompió el deploy.`
    });

    // Auto-merge inmediato — un revert no necesita revisión, el deploy está roto
    try {
      await mergePullRequest({ number: pr.number, mergeMethod: "squash" });
    } catch (e: any) {
      console.warn(`[revert] auto-merge falló:`, e?.message);
    }

    return { ok: true, prUrl: pr.url };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
