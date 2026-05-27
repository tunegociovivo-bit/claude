/**
 * POST /api/v1/admin/import-accesos-from-text
 *
 * Recibe un bloque de texto libre (tipicamente copiado de una tarea
 * del kanban) y lo parsea en bloques por cliente, intentando matchear
 * cada bloque al Client correspondiente por nombre (case-insensitive +
 * fuzzy básico). Devuelve un PREVIEW con qué clientes se van a
 * actualizar y qué accesos se les meterá en `Client.accesos`.
 *
 * Body: { text: string, apply?: boolean }
 *   - apply=false (default) → sólo preview, no toca BD
 *   - apply=true → escribe Client.accesos con el bloque parseado
 *
 * Heurística de parsing:
 * - Buscamos líneas que sean "TÍTULO DE CLIENTE" (mayúsculas o
 *   negrita en markdown).
 * - Todo lo que viene entre un título y el siguiente se considera el
 *   bloque de accesos de ese cliente.
 * - Líneas vacías al inicio/fin del bloque se trimean.
 *
 * Matching de cliente:
 * - Normaliza ambos lados (lowercase, sin tildes, sin puntuación) y
 *   busca igualdad o "incluye".
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  text: z.string().min(10),
  apply: z.boolean().default(false),
  // Estrategia para clientes que YA tienen accesos rellenos:
  //   "skip" → no se tocan
  //   "overwrite" → se sobreescriben
  //   "append" → se añade al final con separador
  onConflict: z.enum(["skip", "overwrite", "append"]).default("skip")
});

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // sin tildes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ParsedBlock = { header: string; content: string };

/**
 * Detecta bloques por cliente. Heurística:
 * - Una "cabecera" es una línea con texto que va seguida de líneas
 *   de detalle. Tratamos como cabecera cualquier línea que cumple
 *   alguno de estos patrones:
 *     · Empieza con ## / ### / # de markdown
 *     · Va en negrita markdown (**TEXTO**)
 *     · Está en MAYÚSCULAS y tiene <= 60 chars y >= 2 palabras
 *     · Termina con ":" y es corta
 *   El resto de líneas son contenido del bloque actual.
 */
function parseBlocks(text: string): ParsedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let current: ParsedBlock | null = null;

  const isHeader = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Markdown #
    const mdMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (mdMatch) return mdMatch[1].trim().replace(/[*_]/g, "");
    // **TEXTO**
    const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (boldMatch) return boldMatch[1].trim();
    // TEXTO TODO MAYUS (sin demasiados caracteres)
    if (trimmed.length <= 80 && trimmed.length >= 3) {
      const letters = trimmed.replace(/[^a-zA-ZÁÉÍÓÚÑáéíóúñ]/g, "");
      if (letters.length >= 3 && letters === letters.toUpperCase()) {
        return trimmed.replace(/:$/, "").trim();
      }
    }
    // "Cliente Foo:" (acaba en :)
    if (trimmed.length <= 60 && /^[A-ZÁÉÍÓÚÑa-záéíóúñ][^:]+:$/.test(trimmed)) {
      const noColon = trimmed.replace(/:$/, "");
      // Sólo si no parece "user:", "password:", "url:"
      if (!/^(user|usuario|password|contraseña|pass|url|host|puerto|port)/i.test(noColon)) {
        return noColon.trim();
      }
    }
    return null;
  };

  for (const raw of lines) {
    const header = isHeader(raw);
    if (header) {
      if (current && current.content.trim()) blocks.push(current);
      current = { header, content: "" };
    } else if (current) {
      current.content += raw + "\n";
    }
  }
  if (current && current.content.trim()) blocks.push(current);

  // Trim de contenido
  return blocks.map((b) => ({ header: b.header, content: b.content.trim() }));
}

type MatchResult = {
  block: ParsedBlock;
  clientId: string | null;
  clientName: string | null;
  matchType: "exact" | "contains" | "none";
  existingAccesos: string | null;
};

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const blocks = parseBlocks(parsed.data.text);

  const clients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true, accesos: true }
  });

  // Pre-normalizar nombres de cliente
  const normClients = clients.map((c) => ({
    id: c.id,
    name: c.name,
    normName: normalize(c.name),
    existing: c.accesos ?? null
  }));

  function matchClient(header: string): MatchResult["matchType"] extends "none" ? null : { id: string; name: string; matchType: "exact" | "contains"; existing: string | null } | null {
    const nh = normalize(header);
    if (!nh) return null;
    // Exact
    for (const c of normClients) {
      if (c.normName === nh) return { id: c.id, name: c.name, matchType: "exact" as const, existing: c.existing };
    }
    // Contains (cliente.name dentro del header o viceversa)
    for (const c of normClients) {
      if (nh.includes(c.normName) || c.normName.includes(nh)) {
        return { id: c.id, name: c.name, matchType: "contains" as const, existing: c.existing };
      }
    }
    return null;
  }

  const matches: MatchResult[] = blocks.map((b) => {
    const m = matchClient(b.header);
    return {
      block: b,
      clientId: m?.id ?? null,
      clientName: m?.name ?? null,
      matchType: (m?.matchType ?? "none") as MatchResult["matchType"],
      existingAccesos: m?.existing ?? null
    };
  });

  if (!parsed.data.apply) {
    return NextResponse.json({
      mode: "preview",
      blocksDetected: blocks.length,
      matches: matches.map((m) => ({
        header: m.block.header,
        contentPreview: m.block.content.slice(0, 200),
        contentLength: m.block.content.length,
        clientId: m.clientId,
        clientName: m.clientName,
        matchType: m.matchType,
        existingAccesosLength: m.existingAccesos?.length ?? 0,
        willSkip:
          m.matchType === "none" ||
          (parsed.data.onConflict === "skip" && (m.existingAccesos?.length ?? 0) > 0)
      }))
    });
  }

  // APLICAR
  let updated = 0;
  let skipped = 0;
  const skippedReasons: string[] = [];
  for (const m of matches) {
    if (!m.clientId) {
      skipped++;
      skippedReasons.push(`"${m.block.header}" → sin match`);
      continue;
    }
    const has = (m.existingAccesos?.length ?? 0) > 0;
    if (has && parsed.data.onConflict === "skip") {
      skipped++;
      skippedReasons.push(`"${m.clientName}" → ya tenía accesos (skip)`);
      continue;
    }
    let newAccesos = m.block.content;
    if (has && parsed.data.onConflict === "append") {
      newAccesos = `${m.existingAccesos}\n\n--- importado ---\n${m.block.content}`;
    }
    await prisma.client.update({
      where: { id: m.clientId },
      data: { accesos: newAccesos }
    });
    updated++;
  }

  return NextResponse.json({
    mode: "applied",
    updated,
    skipped,
    skippedReasons: skippedReasons.slice(0, 20)
  });
});
