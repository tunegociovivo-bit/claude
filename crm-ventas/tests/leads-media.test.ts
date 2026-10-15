import test from "node:test";
import assert from "node:assert/strict";
import {
  addAttempt,
  appendLeadInfo,
  readAttempts,
  removeAttempt,
  validAttemptDate,
  DEFAULT_LEAD_STATUSES,
  firstName,
  forwardTargetErrors,
  isForwardTargetPhone,
  matchLine,
  normalizeForwardTargets,
  normalizeStatuses,
  parseLeadPayload,
  readLeadsConfig,
  renderLeadTemplate,
} from "../lib/leads/config";
import {
  extractMedia,
  extractSpecialText,
  isInlineType,
  mediaAiText,
  mediaBody,
  publicMessageMeta,
  safeServeType,
  sniffAudioFormat,
  wahaFilePath,
} from "../lib/inbox/media-core";

// ---------------------------------------------------------------- leads

test("estados por defecto y normalización de la lista editable", () => {
  assert.deepEqual(normalizeStatuses(undefined).map((s) => s.id), DEFAULT_LEAD_STATUSES.map((s) => s.id));
  const custom = normalizeStatuses([
    { label: "  Pendiente de fotos " },
    { id: "pendiente_de_fotos", label: "Pendiente (dup)" },
    { label: "<b>VIP</b>", color: "violet" },
    { label: "" },
  ]);
  assert.deepEqual(
    custom.map((s) => [s.id, s.label, s.color]),
    [
      ["pendiente_de_fotos", "Pendiente de fotos", "slate"],
      ["pendiente_de_fotos_2", "Pendiente (dup)", "slate"],
      ["bvip_b", "bVIP/b", "violet"],
    ]
  );
  // Lista vacía → vuelve a los estados por defecto (nunca un desplegable vacío).
  assert.equal(normalizeStatuses([]).length, DEFAULT_LEAD_STATUSES.length);
});

test("destinos de «ENVIAR A»: teléfonos normalizados, sin duplicados y con errores legibles", () => {
  const targets = normalizeForwardTargets([
    { label: "TURCAS", phone: "+90 530 432 37 29" },
    { label: "ANA", phone: "680523951" },
    { label: "ROCHAR", phone: "609 517 110" },
    { label: "ANA otra vez", phone: "+34680523951" },
    { label: "sin teléfono", phone: "" },
  ]);
  assert.deepEqual(
    targets.map((t) => [t.label, t.phone]),
    [
      ["TURCAS", "905304323729"],
      ["ANA", "34680523951"],
      ["ROCHAR", "34609517110"],
    ]
  );
  assert.ok(targets.every((t) => /^[A-Za-z0-9_-]{4,40}$/.test(t.id)));
  assert.equal(forwardTargetErrors([{ label: "", phone: "abc" }]).length, 2);
  assert.ok(isForwardTargetPhone(targets, "905304323729"));
  assert.ok(isForwardTargetPhone(targets, "34680523951"));
  assert.ok(!isForwardTargetPhone(targets, "34600000000"));
  assert.ok(!isForwardTargetPhone(targets, "12345@lid"));
});

test("la configuración guardada se lee con valores seguros", () => {
  const cfg = readLeadsConfig({ leads: { intakeToken: "corto", forwardTargets: [{ label: "X", phone: "+90 530 432 37 29", id: "abcd1" }] } });
  assert.equal(cfg.intakeToken, "");
  assert.equal(cfg.forwardTargets[0].id, "abcd1");
  assert.equal(cfg.statuses.length, DEFAULT_LEAD_STATUSES.length);
});

test("plantilla del primer mensaje con y sin nombre", () => {
  const tpl = "Hola {nombre}, soy Rochar de Clínica March. Hemos recibido tu solicitud sobre {tratamiento}.";
  assert.equal(
    renderLeadTemplate(tpl, { name: "MARÍA josé López", treatment: "injerto capilar" }),
    "Hola María, soy Rochar de Clínica March. Hemos recibido tu solicitud sobre injerto capilar."
  );
  assert.equal(
    renderLeadTemplate(tpl, { name: "+34 600 000 000", treatment: "injerto capilar" }),
    "Hola, soy Rochar de Clínica March. Hemos recibido tu solicitud sobre injerto capilar."
  );
  assert.equal(renderLeadTemplate("¡Hola {nombre}!", { name: "" }), "¡Hola!");
  assert.equal(firstName("  ana   ruiz "), "Ana");
});

test("payload de Make: nombres en español o inglés y respuestas del formulario", () => {
  const parsed = parseLeadPayload({
    full_name: "Pedro Gómez",
    phone_number: "+34 611 22 33 44",
    "correo_electrónico": "pedro@example.com",
    linea: "609517110",
    tratamiento: "Injerto capilar",
    campaign_name: "Capilar 2026",
    leadgen_id: "123456789",
    respuestas: { "¿cuándo_tienes_pensado_hacerte_el_injerto_capilar?": ["en_los_próximos_3_meses"] },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.lead.name, "Pedro Gómez");
  assert.equal(parsed.lead.phone, "+34 611 22 33 44");
  assert.equal(parsed.lead.email, "pedro@example.com");
  assert.equal(parsed.lead.line, "609517110");
  assert.equal(parsed.lead.leadId, "123456789");
  assert.equal(parsed.lead.campaign, "Capilar 2026");
  assert.deepEqual(parsed.lead.fields, [
    { label: "¿cuándo tienes pensado hacerte el injerto capilar?", value: "en los próximos 3 meses" },
  ]);
  assert.equal(parsed.lead.sendWelcome, true);

  const fieldData = parseLeadPayload({
    telefono: "611223344",
    field_data: [{ name: "zona", values: ["glúteos", "abdomen"] }],
    enviar_mensaje: "no",
  });
  assert.ok(fieldData.ok);
  if (fieldData.ok) {
    assert.deepEqual(fieldData.lead.fields, [{ label: "Zona", value: "glúteos, abdomen" }]);
    assert.equal(fieldData.lead.sendWelcome, false);
  }
  assert.deepEqual(parseLeadPayload({ nombre: "Sin teléfono" }), { ok: false, error: "Falta el teléfono del lead (campo «telefono»)" });
  assert.equal(parseLeadPayload([1, 2]).ok, false);
});

test("historial del lead: se deduplica por lead_id y guarda los 10 últimos", () => {
  const entry = (id: string | null) => ({ id, at: "2026-10-13T10:00:00Z", campaign: "c", treatment: null, form: null, adName: null, lineLabel: null, fields: [] });
  const first = appendLeadInfo(null, entry("a"));
  assert.equal(first?.entries.length, 1);
  assert.equal(appendLeadInfo(first, entry("a")), null);
  let info: any = first;
  for (let i = 0; i < 15; i++) info = appendLeadInfo(info, entry(`x${i}`));
  assert.equal(info.entries.length, 10);
  assert.equal(info.entries[0].id, "x14");
  // Sin lead_id no se puede deduplicar: se añade.
  assert.ok(appendLeadInfo(first, entry(null)));
});

test("el lead se asigna al número del CRM por teléfono o por nombre", () => {
  const lines = [
    { id: "1", label: "Rochar", phone: "34609517110" },
    { id: "2", label: "Ana", phone: "34680523951" },
    { id: "3", label: "Recepción", phone: null },
  ];
  assert.equal(matchLine(lines, "609517110")?.id, "1");
  assert.equal(matchLine(lines, "+34 680 52 39 51")?.id, "2");
  assert.equal(matchLine(lines, "ana")?.id, "2");
  assert.equal(matchLine(lines, "RECEPCIÓN")?.id, "3");
  assert.equal(matchLine(lines, "699999999"), null);
  assert.equal(matchLine(lines, null), null);
});

// ---------------------------------------------------------------- multimedia

test("detecta nota de voz de NOWEB con la URL interna de WAHA", () => {
  const media = extractMedia({
    hasMedia: true,
    body: "",
    media: { url: "http://localhost:3000/api/files/paula-ws/ABC.oga", mimetype: "audio/ogg; codecs=opus", filename: null, error: null },
    _data: { message: { audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" } } },
  });
  assert.equal(media?.kind, "voice");
  assert.equal(media?.mimetype, "audio/ogg; codecs=opus");
  assert.equal(wahaFilePath(media!.url), "/api/files/paula-ws/ABC.oga");
  assert.equal(mediaBody(media!), "🎤 Nota de voz");
});

test("detecta foto con pie, documento con nombre y vídeo de WEBJS", () => {
  const photo = extractMedia({
    hasMedia: true,
    media: { url: "http://waha:3000/api/files/s/1.jpeg", mimetype: "image/jpeg" },
    _data: { message: { imageMessage: { caption: "Así tengo la coronilla" } } },
  });
  assert.equal(photo?.kind, "image");
  assert.equal(photo?.caption, "Así tengo la coronilla");
  assert.equal(mediaBody(photo!), "📷 Foto\nAsí tengo la coronilla");

  const doc = extractMedia({
    hasMedia: true,
    media: { url: "/api/files/s/2.pdf", mimetype: "application/pdf", filename: "analítica <final>.pdf" },
  });
  assert.equal(doc?.kind, "document");
  assert.equal(doc?.filename, "analítica _final_.pdf");
  assert.equal(mediaBody(doc!), "📄 analítica _final_.pdf");

  const video = extractMedia({ hasMedia: true, _data: { type: "video" }, media: { url: "/api/files/s/3.mp4", mimetype: "video/mp4" } });
  assert.equal(video?.kind, "video");

  const sticker = extractMedia({ hasMedia: true, _data: { type: "sticker" }, media: { url: "/api/files/s/4.webp", mimetype: "image/webp" } });
  assert.equal(sticker?.kind, "sticker");
});

test("sin archivo descargado conserva el tipo y el motivo", () => {
  const media = extractMedia({ hasMedia: true, media: { url: null, mimetype: "image/jpeg", error: "download failed" } });
  assert.equal(media?.kind, "image");
  assert.equal(media?.url, null);
  assert.equal(media?.error, "download failed");
});

test("un texto normal no es multimedia", () => {
  assert.equal(extractMedia({ body: "Hola", _data: { type: "chat" } }), null);
  assert.equal(extractMedia({ body: "Hola", _data: { message: { conversation: "Hola" } } }), null);
});

test("solo se descargan rutas /api/files/ del propio WAHA", () => {
  assert.equal(wahaFilePath("http://169.254.169.254/latest/meta-data"), null);
  assert.equal(wahaFilePath("http://x/api/files/../../etc/passwd"), null);
  assert.equal(wahaFilePath(null), null);
  assert.equal(wahaFilePath("https://evil.example/api/files/s/a.jpg"), "/api/files/s/a.jpg");
});

test("ubicación y contactos se guardan como texto", () => {
  assert.equal(
    extractSpecialText({ _data: { message: { locationMessage: { degreesLatitude: 36.5101, degreesLongitude: -4.8825, name: "Clínica" } } } }),
    "📍 Ubicación: Clínica\nhttps://maps.google.com/?q=36.510100,-4.882500"
  );
  assert.equal(
    extractSpecialText({ vCards: ["BEGIN:VCARD\nVERSION:3.0\nFN:Ana Ruiz\nTEL;type=CELL:+34 680 52 39 51\nEND:VCARD"] }),
    "👤 Ana Ruiz · +34 680 52 39 51"
  );
  assert.equal(extractSpecialText({ body: "hola" }), "");
});

test("la IA sabe que llegó un archivo aunque no lo vea", () => {
  assert.match(mediaAiText({ kind: "voice", filename: null, caption: "" }, "in"), /nota de voz.*no puedes escucharla/);
  assert.match(mediaAiText({ kind: "image", filename: null, caption: "mi pelo" }, "in"), /foto[\s\S]*mi pelo$/);
});

test("nunca se sirve HTML ni SVG desde los adjuntos", () => {
  assert.equal(safeServeType("text/html"), "application/octet-stream");
  assert.equal(safeServeType("image/svg+xml"), "application/octet-stream");
  assert.equal(safeServeType("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(isInlineType("application/pdf"), true);
  assert.equal(isInlineType("application/zip"), false);
});

test("la ruta del archivo debe ser de la sesión del evento", () => {
  assert.equal(wahaFilePath("http://localhost:3000/api/files/paula-a/x.jpg", "paula-a"), "/api/files/paula-a/x.jpg");
  assert.equal(wahaFilePath("http://localhost:3000/api/files/paula-b/x.jpg", "paula-a"), null);
  assert.equal(wahaFilePath("http://localhost:3000/api/files/x.jpg", "paula-a"), "/api/files/x.jpg");
  assert.equal(wahaFilePath("http://localhost:3000/api/files/a/b/c.jpg", "a"), null);
});

test("al navegador no llegan las claves del almacenamiento", () => {
  const meta = publicMessageMeta({ pushName: "P", media: { kind: "image", key: "ws/whatsapp/l/1.jpg", thumbKey: "t", mimetype: "image/jpeg", caption: "", filename: null, size: 1, error: null } }) as any;
  assert.equal(meta.media.key, undefined);
  assert.equal(meta.media.thumbKey, undefined);
  assert.equal(meta.media.hasFile, true);
  assert.equal(meta.media.hasThumb, true);
  assert.equal(meta.pushName, "P");
  assert.deepEqual(publicMessageMeta({ a: 1 }), { a: 1 });
});

test("los destinos se comparan con el número completo", () => {
  const targets = [{ id: "t1", label: "TURCAS", phone: "905304323729" }];
  assert.ok(isForwardTargetPhone(targets, "905304323729"));
  // Mismos 9 últimos dígitos pero otro país: no es el destino.
  assert.ok(!isForwardTargetPhone(targets, "345304323729"));
});

test("intentos de contacto: hora válida, orden y borrado", () => {
  const now = new Date("2026-10-13T18:00:00Z");
  assert.equal(validAttemptDate(undefined, now)?.toISOString(), now.toISOString());
  assert.equal(validAttemptDate("2026-10-13T20:00:00Z", now), null); // futuro
  assert.equal(validAttemptDate("2020-01-01T00:00:00Z", now), null); // demasiado antiguo
  assert.equal(validAttemptDate("no-es-fecha", now), null);
  let list = addAttempt(null, { at: new Date("2026-10-13T17:00:00Z"), by: "u1", byName: "Ana" });
  list = addAttempt(list, { at: new Date("2026-10-13T09:30:00Z"), by: "u2", byName: "Rochar" });
  assert.deepEqual(list.map((a) => a.byName), ["Rochar", "Ana"]);
  assert.equal(readAttempts(list).length, 2);
  assert.equal(removeAttempt(list, list[0].id).length, 1);
  assert.deepEqual(readAttempts([{ id: "x", at: "basura" }, null, "x"]), []);
});

test("solo se convierten grabaciones de audio reales (nunca listas HLS/DASH)", () => {
  assert.equal(sniffAudioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), "matroska");
  assert.equal(sniffAudioFormat(Buffer.from("OggS\x00\x02\x00\x00\x00\x00\x00\x00", "latin1")), "ogg");
  assert.equal(sniffAudioFormat(Buffer.from("\x00\x00\x00\x1cftypM4A \x00\x00", "latin1")), "mov");
  assert.equal(sniffAudioFormat(Buffer.from('<?xml version="1.0"?><MPD><BaseURL>file:///etc/passwd</BaseURL></MPD>')), null);
  assert.equal(sniffAudioFormat(Buffer.from("#EXTM3U\n#EXT-X-VERSION:3\nhttp://127.0.0.1/x")), null);
  assert.equal(sniffAudioFormat(Buffer.from("ffconcat version 1.0\nfile /etc/passwd")), null);
  assert.equal(sniffAudioFormat(Buffer.from("corto")), null);
});

test("lead de Make: guarda el conjunto de anuncios («conjunto» o adset_name)", () => {
  const a = parseLeadPayload({ telefono: "+34 600 000 000", conjunto: "CAMPAÑAS - 2026 PIXEL" });
  assert.equal(a.ok && a.lead.adset, "CAMPAÑAS - 2026 PIXEL");
  const b = parseLeadPayload({ phone_number: "600000000", adset_name: "Conjunto B" });
  assert.equal(b.ok && b.lead.adset, "Conjunto B");
  const c = parseLeadPayload({ telefono: "600000000" });
  assert.equal(c.ok && c.lead.adset, null);
});
