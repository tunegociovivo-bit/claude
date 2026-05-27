/**
 * GET    /api/v1/admin/self-heal-settings  → { hasToken, repo, branch, valid? }
 * PUT    /api/v1/admin/self-heal-settings  → guarda token cifrado + repo + branch
 * DELETE /api/v1/admin/self-heal-settings  → borra config (desactiva self-heal)
 *
 * El PUT valida contra GitHub antes de persistir: hace GET a /repos/{owner}/{repo}
 * con el token — si responde 200 está OK; si 401 (token inválido) o 404
 * (repo inexistente o sin acceso) devolvemos error claro para que el
 * admin sepa qué tocar.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

const DEFAULT_REPO = "tunegociovivo-bit/claude";
const DEFAULT_BRANCH = "claude/internal-project-platform-ZezvX";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const cfg = (ws?.settings as any)?.integrations?.selfHeal ?? {};
  return NextResponse.json({
    hasToken: !!cfg.tokenEnc,
    repo: cfg.repo ?? DEFAULT_REPO,
    branch: cfg.branch ?? DEFAULT_BRANCH,
    // Si hay PAT en env como fallback, también lo señalamos
    envFallback:
      !!process.env.GITHUB_SELF_HEAL_TOKEN && !cfg.tokenEnc
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const repoFull =
    typeof body?.repo === "string" && body.repo.trim() ? body.repo.trim() : DEFAULT_REPO;
  const branch =
    typeof body?.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : DEFAULT_BRANCH;

  // Si no llega token nuevo, intentamos mantener el existente.
  const ws0 = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const existingCfg = (ws0?.settings as any)?.integrations?.selfHeal;
  let plainToken = token;
  let encryptedToken: string | undefined = existingCfg?.tokenEnc;
  if (token) {
    encryptedToken = encryptSecret(token);
  } else if (existingCfg?.tokenEnc) {
    const decoded = decryptSecret(existingCfg.tokenEnc);
    if (decoded) plainToken = decoded;
  }
  if (!plainToken) {
    return NextResponse.json(
      { error: "Token requerido la primera vez. Pega un Personal Access Token con scope `repo`." },
      { status: 400 }
    );
  }

  // Validar contra GitHub: GET /repos/{owner}/{repo}
  const r = await fetch(`https://api.github.com/repos/${repoFull}`, {
    headers: {
      Authorization: `Bearer ${plainToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!r.ok) {
    const txt = await r.text();
    return NextResponse.json(
      {
        error:
          r.status === 401
            ? "Token inválido (GitHub respondió 401). Verifica que el PAT tiene scope `repo` y no ha expirado."
            : r.status === 404
              ? `Repo "${repoFull}" no existe o el token no tiene acceso.`
              : `GitHub ${r.status}: ${txt.slice(0, 200)}`
      },
      { status: 400 }
    );
  }
  const repoData = await r.json();

  // Verifica que la branch existe
  const br = await fetch(
    `https://api.github.com/repos/${repoFull}/branches/${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${plainToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );
  if (!br.ok) {
    return NextResponse.json(
      {
        error: `La branch "${branch}" no existe en el repo. Verifica el nombre.`
      },
      { status: 400 }
    );
  }

  // Verifica scopes mínimos: el header x-oauth-scopes debe incluir `repo`
  const scopes = (r.headers.get("x-oauth-scopes") ?? "").toLowerCase();
  if (!scopes.includes("repo")) {
    return NextResponse.json(
      {
        error: `El token NO tiene scope "repo". Scopes detectados: "${scopes}". Crea un PAT nuevo con scope repo completo.`
      },
      { status: 400 }
    );
  }

  const settings: any = ws0?.settings ?? {};
  if (!settings.integrations) settings.integrations = {};
  settings.integrations.selfHeal = {
    tokenEnc: encryptedToken,
    repo: repoFull,
    branch
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({
    ok: true,
    repo: repoFull,
    branch,
    repoFullName: repoData.full_name,
    repoPrivate: !!repoData.private,
    scopes
  });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (settings?.integrations?.selfHeal) {
    delete settings.integrations.selfHeal;
    await prisma.workspace.update({
      where: { id: api.workspaceId },
      data: { settings }
    });
  }
  return NextResponse.json({ ok: true });
});
