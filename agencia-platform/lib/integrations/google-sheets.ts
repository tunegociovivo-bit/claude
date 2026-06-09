/**
 * Cliente Google Sheets API v4 con autenticación por Service Account
 * (JWT RS256 firmado con la private key del JSON del Service Account).
 *
 * Mismo patrón que lib/integrations/google-drive.ts — no usa la librería
 * oficial googleapis para mantener el bundle ligero. (El equivalente en
 * Node de "gspread" de Python es justamente esto: la REST API v4 con un
 * access token OAuth2 generado a partir del service account.)
 *
 * Configuración (workspace.settings.integrations.googleSheets):
 *   { serviceAccountJsonEncrypted: "<aes-256-gcm cipher>" }
 *
 * Si no hay un SA específico de Sheets, caemos al SA de Drive
 * (integrations.googleDrive.serviceAccountJsonEncrypted) — así, si ya
 * tienes Drive configurado, basta con compartir la hoja con ese email.
 *
 * IMPORTANTE: la cuenta de servicio SOLO puede leer/escribir hojas que
 * hayan sido COMPARTIDAS con su email (formato
 * nombre@proyecto.iam.gserviceaccount.com) con permiso de Editor. Eso
 * limita el acceso de forma natural (no hace falta scoping por carpeta
 * como en Drive).
 */

import { createSign } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Lee + descifra el service account a usar para Sheets. Prioriza el
 * específico de Sheets; si no existe, reusa el de Drive.
 */
export async function getSheetsServiceAccount(workspaceId: string): Promise<ServiceAccountKey> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const integrations: any = (ws?.settings as any)?.integrations ?? {};
  const enc =
    integrations?.googleSheets?.serviceAccountJsonEncrypted ??
    integrations?.googleDrive?.serviceAccountJsonEncrypted;
  if (!enc) {
    throw new Error(
      "Google Sheets no configurado: falta el service account. Configúralo en Ajustes → Integraciones (o usa el de Google Drive) y comparte la hoja con su email."
    );
  }
  const jsonStr = decryptSecret(enc);
  if (!jsonStr) throw new Error("No se pudo descifrar el service account de Sheets.");
  let sa: ServiceAccountKey;
  try {
    sa = JSON.parse(jsonStr);
  } catch {
    throw new Error("Service account JSON inválido (parse).");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON sin client_email o private_key.");
  }
  return sa;
}

/** Genera un access token OAuth2 firmando un JWT RS256 con la private key. */
async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const b64u = (obj: any) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const signingInput = `${b64u(header)}.${b64u(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer
    .sign(sa.private_key)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${signingInput}.${signature}`;

  const resp = await fetch(claims.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Google OAuth token ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error("Google OAuth: sin access_token");
  return data.access_token as string;
}

/**
 * Extrae el spreadsheetId de una URL de Google Sheets si el user pega la
 * URL entera. Soporta docs.google.com/spreadsheets/d/{ID}/...
 */
export function parseSpreadsheetId(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return s;
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return s; // ya es un ID
}

async function authedFetch(sa: ServiceAccountKey, url: string, init?: RequestInit) {
  const token = await getAccessToken(sa);
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    if (resp.status === 403 || resp.status === 404) {
      throw new Error(
        `Sheets ${resp.status}: la hoja no existe o no está compartida con ${sa.client_email}. ` +
          `Comparte la hoja con ese email (Editor) y reintenta. Detalle: ${txt.slice(0, 200)}`
      );
    }
    throw new Error(`Sheets ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return resp;
}

export type SpreadsheetInfo = {
  title: string;
  spreadsheetId: string;
  sheets: { title: string; rowCount?: number; columnCount?: number }[];
};

/** Metadatos: título del libro y pestañas (para que Sonia sepa qué rangos existen). */
export async function getSpreadsheetInfo(opts: {
  workspaceId: string;
  spreadsheetId: string;
}): Promise<SpreadsheetInfo> {
  const sa = await getSheetsServiceAccount(opts.workspaceId);
  const id = parseSpreadsheetId(opts.spreadsheetId);
  const url =
    `${API}/${encodeURIComponent(id)}?` +
    new URLSearchParams({
      fields: "properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))"
    });
  const resp = await authedFetch(sa, url);
  const data = await resp.json();
  return {
    title: data?.properties?.title ?? "",
    spreadsheetId: id,
    sheets: (data?.sheets ?? []).map((s: any) => ({
      title: s?.properties?.title ?? "",
      rowCount: s?.properties?.gridProperties?.rowCount,
      columnCount: s?.properties?.gridProperties?.columnCount
    }))
  };
}

/** Lee un rango en notación A1 (ej "Hoja1!A1:D20"). Devuelve filas. */
export async function readRange(opts: {
  workspaceId: string;
  spreadsheetId: string;
  range: string;
}): Promise<string[][]> {
  const sa = await getSheetsServiceAccount(opts.workspaceId);
  const id = parseSpreadsheetId(opts.spreadsheetId);
  const url = `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(opts.range)}`;
  const resp = await authedFetch(sa, url);
  const data = await resp.json();
  return (data?.values ?? []) as string[][];
}

/** Añade filas al final de la tabla del rango (append). No pisa datos. */
export async function appendRows(opts: {
  workspaceId: string;
  spreadsheetId: string;
  range: string;
  rows: (string | number | boolean | null)[][];
}): Promise<{ updatedRange: string; updatedRows: number; updatedCells: number }> {
  const sa = await getSheetsServiceAccount(opts.workspaceId);
  const id = parseSpreadsheetId(opts.spreadsheetId);
  const url =
    `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(opts.range)}:append?` +
    new URLSearchParams({
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS"
    });
  const resp = await authedFetch(sa, url, {
    method: "POST",
    body: JSON.stringify({ values: opts.rows })
  });
  const data = await resp.json();
  const u = data?.updates ?? {};
  return {
    updatedRange: u.updatedRange ?? opts.range,
    updatedRows: u.updatedRows ?? 0,
    updatedCells: u.updatedCells ?? 0
  };
}

/** Sobrescribe un rango concreto (update). Pisa lo que hubiera. */
export async function updateRange(opts: {
  workspaceId: string;
  spreadsheetId: string;
  range: string;
  rows: (string | number | boolean | null)[][];
}): Promise<{ updatedRange: string; updatedRows: number; updatedCells: number }> {
  const sa = await getSheetsServiceAccount(opts.workspaceId);
  const id = parseSpreadsheetId(opts.spreadsheetId);
  const url =
    `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(opts.range)}?` +
    new URLSearchParams({ valueInputOption: "USER_ENTERED" });
  const resp = await authedFetch(sa, url, {
    method: "PUT",
    body: JSON.stringify({ values: opts.rows })
  });
  const data = await resp.json();
  return {
    updatedRange: data?.updatedRange ?? opts.range,
    updatedRows: data?.updatedRows ?? 0,
    updatedCells: data?.updatedCells ?? 0
  };
}

/** Test de conexión: comprueba que el SA puede abrir la hoja. */
export async function testSheetsConnection(opts: {
  workspaceId: string;
  spreadsheetId: string;
}): Promise<{ ok: true; serviceAccountEmail: string; title: string; tabs: string[] }> {
  const sa = await getSheetsServiceAccount(opts.workspaceId);
  const info = await getSpreadsheetInfo(opts);
  return {
    ok: true,
    serviceAccountEmail: sa.client_email,
    title: info.title,
    tabs: info.sheets.map((s) => s.title)
  };
}
