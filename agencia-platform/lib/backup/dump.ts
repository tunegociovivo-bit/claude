/**
 * Genera un dump JSON con TODOS los datos del workspace.
 *
 * Antes este dump listaba los modelos A MANO y solo cubría ~21 de las ~110
 * tablas → faltaba casi todo (databases tipo Notion, leads, facturas,
 * editorial, entregables, webhooks, auditoría, etc.). Ahora recorre
 * dinámicamente el metamodelo de Prisma (`Prisma.dmmf`), así cubre todas las
 * tablas actuales y cualquiera futura sin mantener la lista.
 *
 * Para cada modelo busca (BFS por relaciones) la ruta más corta hasta un
 * modelo con `workspaceId` y filtra por ahí, de modo que el backup queda
 * acotado a este workspace (sin fugas entre tenants).
 *
 * Se EXCLUYEN a propósito:
 * - Tablas de auth/sesión con tokens en claro (Account, Session,
 *   VerificationToken, UserSession, LoginAttempt): son credenciales, no datos
 *   de negocio, y no deben acabar en un archivo descargable.
 * - SearchEmbedding: vectores derivados, regenerables (reindex) y enormes.
 * Además se eliminan campos sensibles a nivel de fila (hashes, tokens y
 * secretos, cifrados o no — ver STRIP_KEYS).
 *
 * No incluye los binarios de File (solo metadata; los binarios viven en R2).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type DumpResult = {
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  counts: Record<string, number>;
  data: Record<string, any[]>;
  /** Modelos no volcados (excluidos a propósito o sin relación con el workspace). */
  skippedModels?: string[];
  /** Modelos que fallaron al volcarse, con el motivo (no abortan el resto). */
  modelErrors?: Record<string, string>;
};

// Campos que NUNCA deben salir en un backup descargable (credenciales).
const STRIP_KEYS = new Set([
  "passwordHash",
  "password",
  "hashed",
  "p256dh",
  "authKey",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "id_token",
  "sessionToken",
  "passwordEnc",
  "accessTokenEnc",
  "refreshTokenEnc",
  "apiKeyEnc",
  "serviceAccountJsonEncrypted",
  "private_key",
  "privateKey"
]);

// Modelos que NO se vuelcan (credenciales / framework / derivados regenerables).
const EXCLUDE_MODELS = new Set([
  "Account",
  "Session",
  "VerificationToken",
  "UserSession",
  "LoginAttempt",
  "SearchEmbedding"
]);

function strip<T extends object>(row: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(row as any)) {
    if (STRIP_KEYS.has(k)) continue;
    // BigInt no es serializable por JSON.stringify → a string.
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out as T;
}

type ModelInfo = {
  name: string;
  delegate: string;
  hasWorkspaceId: boolean;
  relations: { name: string; target: string; isList: boolean }[];
};

function buildModelIndex(): Map<string, ModelInfo> {
  const index = new Map<string, ModelInfo>();
  for (const m of Prisma.dmmf.datamodel.models) {
    const hasWorkspaceId = m.fields.some((f) => f.kind === "scalar" && f.name === "workspaceId");
    const relations = m.fields
      .filter((f) => f.kind === "object")
      .map((f) => ({ name: f.name, target: f.type, isList: !!f.isList }));
    index.set(m.name, {
      name: m.name,
      delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1),
      hasWorkspaceId,
      relations
    });
  }
  return index;
}

/**
 * Devuelve un `where` que acota `modelName` al workspace, o null si no hay
 * ninguna ruta de relaciones hasta un modelo con `workspaceId`.
 */
function buildWorkspaceWhere(
  modelName: string,
  index: Map<string, ModelInfo>,
  workspaceId: string
): any | null {
  const start = index.get(modelName);
  if (!start) return null;
  if (start.hasWorkspaceId) return { workspaceId };

  type Step = { rel: string; isList: boolean };
  const queue: { model: string; path: Step[] }[] = [{ model: modelName, path: [] }];
  const visited = new Set<string>([modelName]);

  while (queue.length) {
    const { model, path } = queue.shift()!;
    const info = index.get(model);
    if (!info) continue;
    for (const rel of info.relations) {
      const target = index.get(rel.target);
      if (!target) continue;
      const newPath: Step[] = [...path, { rel: rel.name, isList: rel.isList }];
      if (target.hasWorkspaceId) {
        // Construir el where anidado de dentro hacia fuera.
        let inner: any = { workspaceId };
        for (let i = newPath.length - 1; i >= 0; i--) {
          const s = newPath[i];
          inner = { [s.rel]: s.isList ? { some: inner } : inner };
        }
        return inner;
      }
      if (!visited.has(rel.target)) {
        visited.add(rel.target);
        queue.push({ model: rel.target, path: newPath });
      }
    }
  }
  return null;
}

export async function generateWorkspaceDump(workspaceId: string): Promise<DumpResult> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error("Workspace no encontrado");

  const index = buildModelIndex();
  const data: Record<string, any[]> = {};
  const skippedModels: string[] = [];
  const modelErrors: Record<string, string> = {};

  for (const [name, info] of index) {
    // El propio Workspace se vuelca aparte (es la raíz, no tiene workspaceId).
    if (name === "Workspace") continue;
    if (EXCLUDE_MODELS.has(name)) {
      skippedModels.push(name);
      continue;
    }
    const where = buildWorkspaceWhere(name, index, workspaceId);
    if (!where) {
      // Modelo global sin relación con el workspace: no se puede acotar.
      skippedModels.push(name);
      continue;
    }
    const delegate = (prisma as any)[info.delegate];
    if (!delegate?.findMany) {
      skippedModels.push(name);
      continue;
    }
    try {
      const rows = await delegate.findMany({ where });
      data[info.delegate] = rows.map((r: any) => strip(r));
    } catch (e: any) {
      modelErrors[info.delegate] = String(e?.message ?? e).slice(0, 200);
    }
  }

  // En File solo guardamos metadata; el binario vive en R2 bajo s3Key.
  if (Array.isArray(data.file)) {
    data.file = data.file.map((f: any) => ({ ...f, _note: "binario en R2 (s3Key)" }));
  }

  const dataWithWs: Record<string, any[]> = { workspace: [strip(ws as any)], ...data };

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(dataWithWs)) counts[k] = v.length;

  return {
    generatedAt: new Date().toISOString(),
    workspaceId,
    workspaceName: ws.name,
    counts,
    data: dataWithWs,
    skippedModels: skippedModels.sort(),
    modelErrors: Object.keys(modelErrors).length ? modelErrors : undefined
  };
}
