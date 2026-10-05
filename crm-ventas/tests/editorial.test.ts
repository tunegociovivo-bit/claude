import test from "node:test";
import assert from "node:assert/strict";

process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://crm.example.com";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-for-editorial-tests";

import { coveredTopics, normalizeTopics, repeatsUsedContent } from "../lib/editorial/month-context";
import { editorialStorageKey, mediaIdentity, parseMediaUrls, prependMediaUrl } from "../lib/editorial/media";
import { parseAspectRatioDims, pickOpenAiSize } from "../lib/editorial/generate-image";
import { syncPublicationEdit } from "../lib/editorial/sync-publication-edit";
import { assertWorkspaceAssetUrl, workspaceStorageKey } from "../lib/editorial/assets";
import { dbFileUrl } from "../lib/storage/r2";

test("temas obligatorios: deduplica sin perder etiquetas y mide cobertura real", () => {
  assert.deepEqual(normalizeTopics([" Bótox ", "bótox", "", "Rinoplastia"]), ["bótox", "Rinoplastia"]);
  assert.deepEqual(
    coveredTopics({ title: "Estores", content: "Conoce los estores enrollables y las cortinas de lino" }, ["Estores enrollables", "cortinas", "toldos"]),
    ["Estores enrollables", "cortinas"]
  );
});

test("contenido ya utilizado: detecta títulos repetidos y copys casi idénticos", () => {
  assert.equal(repeatsUsedContent({ title: "¡El menú de hoy!" }, [{ title: "El menu de hoy", content: "otro" }]), true);
  const copy = "Descubre nuestros estores enrollables fabricados a medida usando tejidos técnicos seleccionados cuidadosamente para ofrecer luz natural sin perder privacidad";
  assert.equal(repeatsUsedContent({ title: "Nuevo", content: copy + " siempre" }, [{ title: "Viejo", content: copy }]), true);
  assert.equal(
    repeatsUsedContent({ title: "Estores: instalación", content: "Cómo medir la ventana" }, [{ title: "Estores: tejidos", content: "Qué tejido elegir" }]),
    false
  );
});

test("media: identidad sin firma, también para URLs relativas de /api/files", () => {
  const a = "https://crm.example.com/api/files/w1/editorial/p/x.png?e=1&s=aaa";
  const b = "https://crm.example.com/api/files/w1/editorial/p/x.png?e=2&s=bbb";
  assert.equal(mediaIdentity(a), mediaIdentity(b));
  assert.equal(mediaIdentity("/api/files/w1/x.png?e=1&s=a"), mediaIdentity("/api/files/w1/x.png?e=9&s=z"));
  const merged = JSON.parse(prependMediaUrl(JSON.stringify([a, "https://cdn.example.com/y.png"]), b));
  assert.deepEqual(merged, [b, "https://cdn.example.com/y.png"]);
  assert.deepEqual(parseMediaUrls("no-json"), []);
});

test("media: solo reconoce archivos propios del mismo negocio", () => {
  const own = dbFileUrl("w1/editorial/p1/gen.png");
  const foreign = dbFileUrl("w2/editorial/p9/gen.png");
  assert.equal(editorialStorageKey(own, "w1"), "w1/editorial/p1/gen.png");
  assert.equal(editorialStorageKey(foreign, "w1"), null);
  assert.equal(workspaceStorageKey(foreign, "w1"), null);
  assert.equal(workspaceStorageKey(own, "w1"), "w1/editorial/p1/gen.png");
});

test("recursos de marca: rechaza archivos de otro negocio y direcciones internas", async () => {
  await assert.doesNotReject(assertWorkspaceAssetUrl(dbFileUrl("w1/brand/b/logo.png"), "w1"));
  await assert.rejects(assertWorkspaceAssetUrl(dbFileUrl("w2/brand/b/logo.png"), "w1"), /no pertenece/);
  await assert.rejects(assertWorkspaceAssetUrl("http://127.0.0.1/logo.png", "w1"), /no es pública/);
  await assert.rejects(assertWorkspaceAssetUrl("http://localhost:3000/x.png", "w1"), /no es pública/);
  await assert.rejects(assertWorkspaceAssetUrl("https://bucket.abc.r2.cloudflarestorage.com/w2/brand/x.png", "w1"), /no pertenece/);
});

test("aspect ratio elegido: se mapea al tamaño de imagen soportado", () => {
  assert.equal(parseAspectRatioDims("auto"), null);
  assert.deepEqual(parseAspectRatioDims("9:16"), { width: 1024, height: 1820 });
  assert.equal(pickOpenAiSize(1080, 1920), "1024x1536");
  assert.equal(pickOpenAiSize(1920, 1080), "1536x1024");
  assert.equal(pickOpenAiSize(1080, 1350), "1024x1024");
});

const channel = (status: string) => ({ id: status, status, metaJson: { history: [{ status: "PENDING" }], mediaUrls: ["image"] } });
const locked = (...states: string[]) => ({ post: { id: "p", clientId: "brand", status: "APPROVED" }, channels: states.map(channel) }) as any;
function fakeTx() {
  const calls: any[] = [];
  return { calls, tx: { editorialPublication: { update: async (arg: any) => { calls.push(arg); return {}; } } } as any };
}

test("reprogramar mueve los envíos pendientes a la nueva hora conservando historial", async () => {
  const { calls, tx } = fakeTx();
  const scheduledFor = new Date(Date.now() + 100_000);
  await syncPublicationEdit(tx, locked("PENDING", "SCHEDULED", "PUBLISHED", "FAILED"), { scheduledFor }, "u");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.status, "SCHEDULED");
  assert.equal(calls[0].data.metaJson.history.length, 2);
  assert.deepEqual(calls[0].data.metaJson.mediaUrls, ["image"]);
});

test("pasar a borrador cancela los envíos no publicados; fecha pasada se rechaza", async () => {
  const { calls, tx } = fakeTx();
  await syncPublicationEdit(tx, locked("PENDING", "SCHEDULED", "FAILED", "PUBLISHED"), { status: "DRAFT" });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.data.status === "CANCELLED" && c.data.scheduledFor === null));
  await assert.rejects(syncPublicationEdit(fakeTx().tx, locked("SCHEDULED"), { scheduledFor: new Date(0) }), /fecha futura/);
});
