import test from "node:test";
import assert from "node:assert/strict";

process.env.STORAGE_ENDPOINT = "https://acct123.r2.cloudflarestorage.com";
process.env.STORAGE_ACCESS_KEY_ID = "k";
process.env.STORAGE_SECRET_ACCESS_KEY = "s";
process.env.STORAGE_BUCKET = "nvbucket";
process.env.ENCRYPTION_KEY = "test-key";
process.env.PUBLIC_APP_URL = "https://app.example.com";

test("extractS3Key: path-style, mayúsculas, puerto y virtual-host dan la misma key", async () => {
  const { extractS3Key } = await import("../lib/storage/resign");
  const key = "wsA/editorial/p1/img.png";
  assert.equal(extractS3Key(`https://acct123.r2.cloudflarestorage.com/nvbucket/${key}?X-Amz-Date=x`), key);
  assert.equal(extractS3Key(`https://ACCT123.R2.cloudflarestorage.com:443/nvbucket/${key}`), key);
  assert.equal(extractS3Key(`https://nvbucket.acct123.r2.cloudflarestorage.com/${key}`), key);
  // Sin el bucket configurado delante NO se quita el primer segmento.
  assert.equal(extractS3Key(`https://acct123.r2.cloudflarestorage.com/wsB/${key}`), `wsB/${key}`);
});

test("workspaceKeyFromUrl: solo devuelve keys del propio negocio", async () => {
  const { workspaceKeyFromUrl } = await import("../lib/storage/resign");
  const victim = "wsVictim/editorial/p9/secret.png";
  // Truco del informe de revisión: prefijo del atacante + key de la víctima.
  assert.equal(workspaceKeyFromUrl(`https://ACCT123.r2.cloudflarestorage.com/wsAttacker/${victim}`, "wsAttacker"), `wsAttacker/${victim}`);
  assert.equal(workspaceKeyFromUrl(`https://acct123.r2.cloudflarestorage.com/nvbucket/${victim}`, "wsAttacker"), null);
  assert.equal(workspaceKeyFromUrl(`https://app.example.com/api/files/${victim}?e=1&s=x`, "wsAttacker"), null);
  assert.equal(workspaceKeyFromUrl(`https://app.example.com/api/files/wsAttacker/../${victim}`, "wsAttacker"), null);
});

test("resignUrlIfNeeded no firma archivos de otro negocio", async () => {
  const { resignUrlIfNeeded } = await import("../lib/storage/resign");
  const foreignDb = "https://app.example.com/api/files/wsVictim/editorial/p9/secret.png?e=1&s=old";
  assert.equal(await resignUrlIfNeeded(foreignDb, "wsAttacker"), foreignDb);
  const foreignS3 = "https://acct123.r2.cloudflarestorage.com/nvbucket/wsVictim/editorial/p9/secret.png";
  assert.equal(await resignUrlIfNeeded(foreignS3, "wsAttacker"), foreignS3);
  const ownDb = "https://app.example.com/api/files/wsAttacker/editorial/p1/a.png?e=1&s=old";
  const fresh = await resignUrlIfNeeded(ownDb, "wsAttacker");
  assert.ok(fresh && fresh !== ownDb && fresh.startsWith("https://app.example.com/api/files/wsAttacker/"));
});
