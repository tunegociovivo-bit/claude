/**
 * Cliente Google Drive REST API v3 con autenticación por Service Account
 * (JWT firmado con la private key del JSON descargado de Google Cloud).
 *
 * No usa la librería oficial googleapis para mantener bundle ligero.
 *
 * Configuración esperada en workspace.settings.integrations.googleDrive:
 *   {
 *     serviceAccountJsonEncrypted: "<aes-256-gcm cipher>",
 *     folderId: "1B5BGHeSw...",  // folder ID donde subir backups
 *   }
 *
 * El JSON del Service Account se descarga desde Google Cloud Console:
 *   IAM & Admin → Service Accounts → Create → Keys → Add key (JSON)
 *
 * Después hay que compartir la carpeta de Drive con el email del SA
 * (formato: nombre@proyecto.iam.gserviceaccount.com) con permiso Editor.
 */

import { createSign } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const SCOPE = "https://www.googleapis.com/auth/drive";

export async function getDriveConfig(workspaceId: string): Promise<{
  serviceAccount: ServiceAccountKey;
  folderId: string;
}> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings: any = ws?.settings ?? {};
  const gd = settings?.integrations?.googleDrive ?? {};
  if (!gd.serviceAccountJsonEncrypted) {
    throw new Error("Google Drive no configurado: falta service account.");
  }
  if (!gd.folderId) {
    throw new Error("Google Drive no configurado: falta carpeta destino.");
  }
  const jsonStr = decryptSecret(gd.serviceAccountJsonEncrypted);
  if (!jsonStr) throw new Error("No se pudo descifrar el service account.");
  let sa: ServiceAccountKey;
  try {
    sa = JSON.parse(jsonStr);
  } catch {
    throw new Error("Service account JSON inválido (parse).");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON sin client_email o private_key.");
  }
  return { serviceAccount: sa, folderId: String(gd.folderId) };
}

/**
 * Genera un access token OAuth2 firmando un JWT RS256 con la private key
 * del service account.
 */
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

export type DriveFile = {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
};

/**
 * Lista archivos de la carpeta destino. Opcionalmente filtra por prefijo
 * de nombre.
 */
export async function listDriveFiles(opts: {
  workspaceId: string;
  namePrefix?: string;
}): Promise<DriveFile[]> {
  const { serviceAccount, folderId } = await getDriveConfig(opts.workspaceId);
  const token = await getAccessToken(serviceAccount);

  let q = `'${folderId}' in parents and trashed = false`;
  if (opts.namePrefix) {
    // Escapar comillas simples
    const safe = opts.namePrefix.replace(/'/g, "\\'");
    q += ` and name contains '${safe}'`;
  }
  const url =
    "https://www.googleapis.com/drive/v3/files?" +
    new URLSearchParams({
      q,
      fields: "files(id, name, size, createdTime, modifiedTime)",
      pageSize: "100",
      orderBy: "createdTime desc"
    });
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Drive list ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  return (data.files ?? []) as DriveFile[];
}

/**
 * Sube un archivo a la carpeta destino. Si ya existe uno con ese nombre
 * exacto, lo sobrescribe (actualiza el media; mismo fileId).
 */
export async function uploadDriveFile(opts: {
  workspaceId: string;
  fileName: string;
  body: Buffer | Uint8Array;
  mimeType: string;
}): Promise<DriveFile> {
  const { serviceAccount, folderId } = await getDriveConfig(opts.workspaceId);
  const token = await getAccessToken(serviceAccount);

  // ¿Existe ya un fichero con ese nombre exacto? → actualizar
  const existing = await listDriveFiles({
    workspaceId: opts.workspaceId,
    namePrefix: opts.fileName
  });
  const exactMatch = existing.find((f) => f.name === opts.fileName);

  if (exactMatch) {
    // PATCH /upload/drive/v3/files/{fileId}?uploadType=media
    const resp = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${exactMatch.id}?uploadType=media&fields=id,name,size,createdTime,modifiedTime`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": opts.mimeType
        },
        body: opts.body as BodyInit
      }
    );
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Drive update ${resp.status}: ${txt.slice(0, 300)}`);
    }
    return (await resp.json()) as DriveFile;
  }

  // POST multipart: metadata + media en una sola petición
  const boundary = "----agencia-hub-boundary-" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: opts.fileName, parents: [folderId] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const bodyBuf = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
  const multipart = Buffer.concat([head, bodyBuf, tail]);

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipart as unknown as BodyInit
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Drive upload ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return (await resp.json()) as DriveFile;
}

export async function deleteDriveFile(opts: {
  workspaceId: string;
  fileId: string;
}): Promise<void> {
  const { serviceAccount } = await getDriveConfig(opts.workspaceId);
  const token = await getAccessToken(serviceAccount);
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${opts.fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text();
    throw new Error(`Drive delete ${resp.status}: ${txt.slice(0, 300)}`);
  }
}

/**
 * Helper de "test connection": comprueba que el SA puede listar la
 * carpeta y devuelve metadatos básicos para que el admin lo verifique.
 */
export async function testDriveConnection(workspaceId: string): Promise<{
  ok: true;
  serviceAccountEmail: string;
  folderId: string;
  fileCount: number;
}> {
  const { serviceAccount, folderId } = await getDriveConfig(workspaceId);
  const files = await listDriveFiles({ workspaceId });
  return {
    ok: true,
    serviceAccountEmail: serviceAccount.client_email,
    folderId,
    fileCount: files.length
  };
}

/**
 * Extrae el folderId de una URL de Drive si el user pega la URL entera.
 * Soporta: drive.google.com/drive/folders/{ID}, ?id={ID}
 */
export function parseFolderIdFromUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  const m1 = s.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m2) return m2[1];
  return s; // ya es un ID
}
