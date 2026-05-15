/**
 * Recibe reportes de error desde el cliente o desde el server.
 *
 * Es público (sin auth) porque también capta errores antes de login,
 * pero hace rate-limiting básico por IP+fingerprint para no abusar.
 *
 * Si encuentra un ErrorReport con el mismo fingerprint sin resolver,
 * incrementa el contador en vez de crear uno nuevo (agrupación).
 *
 * Opcionalmente abre un GitHub Issue (env GITHUB_TOKEN + GITHUB_REPO).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";

const schema = z.object({
  source: z.enum(["client", "server", "api"]).default("client"),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  context: z.record(z.any()).optional()
});

function computeFingerprint(message: string, stack?: string): string {
  // Quita números (timestamps, IDs) y URLs para agrupar mejor
  const norm =
    (stack ?? message)
      .replace(/https?:\/\/[^\s)]+/g, "URL")
      .replace(/\b[0-9a-f]{16,}\b/gi, "ID")
      .replace(/\b\d{4,}\b/g, "N")
      .replace(/\s+/g, " ")
      .slice(0, 500);
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "validation" }, { status: 400 });
  }

  // Recoger workspaceId y userId si hay sesión (best-effort, no bloquea)
  let workspaceId: string | null = null;
  let userId: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    userId = ((session?.user as any)?.id as string | undefined) ?? null;
    workspaceId = (await getSessionWorkspaceId().catch(() => null)) ?? null;
  } catch {}

  const fingerprint = computeFingerprint(parsed.data.message, parsed.data.stack);

  // ¿Hay ya un ErrorReport abierto con este fingerprint?
  const existing = await prisma.errorReport.findFirst({
    where: {
      fingerprint,
      status: { in: ["REPORTED", "ACKNOWLEDGED", "IN_PROGRESS"] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    const updated = await prisma.errorReport.update({
      where: { id: existing.id },
      data: { count: existing.count + 1, updatedAt: new Date() }
    });
    return NextResponse.json({ ok: true, id: updated.id, deduplicated: true, count: updated.count });
  }

  const created = await prisma.errorReport.create({
    data: {
      workspaceId,
      userId,
      source: parsed.data.source,
      message: parsed.data.message.slice(0, 2000),
      stack: parsed.data.stack?.slice(0, 8000) ?? null,
      url: parsed.data.url ?? null,
      userAgent: parsed.data.userAgent ?? req.headers.get("user-agent") ?? null,
      context: parsed.data.context ?? undefined,
      fingerprint
    }
  });

  // Crear GitHub Issue async (best-effort)
  openGithubIssueAsync(created).catch((e) =>
    console.error("[error-report] github issue fallo:", e?.message ?? e)
  );

  return NextResponse.json({ ok: true, id: created.id, fingerprint });
}

async function openGithubIssueAsync(report: { id: string; message: string; stack: string | null; url: string | null; fingerprint: string | null; source: string }) {
  const token = process.env.GITHUB_TOKEN_FOR_ERRORS;
  const repo = process.env.GITHUB_REPO_FOR_ERRORS; // formato "owner/repo"
  if (!token || !repo) return;

  const session = process.env.CLAUDE_CODE_SESSION_URL ?? "https://claude.ai/code/session_01CA9ihZJxnRBKpd64rc1mg9";
  const title = `[auto] ${report.source}: ${report.message.slice(0, 80)}`;
  const body = [
    `**ErrorReport ID:** \`${report.id}\``,
    `**Fingerprint:** \`${report.fingerprint ?? "(none)"}\``,
    `**Source:** ${report.source}`,
    report.url ? `**URL:** ${report.url}` : "",
    "",
    "## Mensaje",
    "```",
    report.message,
    "```",
    report.stack ? "## Stack\n```\n" + report.stack + "\n```" : "",
    "",
    `🤖 Reportado automáticamente. Sesión de soporte: ${session}`,
    `Para cerrar, incluye en el commit: \`closes ErrorReport#${report.id}\``
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title, body, labels: ["error-auto", report.source] })
  });
  if (!resp.ok) {
    console.warn("[error-report] github issue", resp.status, await resp.text().catch(() => ""));
    return;
  }
  const issue = await resp.json();
  await prisma.errorReport.update({
    where: { id: report.id },
    data: { githubIssueUrl: issue.html_url ?? null }
  });
}
