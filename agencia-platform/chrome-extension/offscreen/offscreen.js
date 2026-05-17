/**
 * Offscreen document — el único contexto de la extensión con acceso a
 * DOM y a Web APIs como MediaRecorder. Vive mientras dure la
 * grabación; el service worker lo crea al "start" y lo cierra al
 * recibir "upload-result".
 *
 * Recibe del service worker:
 *   { target:"offscreen", type:"start-recording", streamId,
 *     meetingUrl, meetingTitle, hubUrl, apiKey }
 *   { target:"offscreen", type:"stop-recording" }
 *
 * Devuelve al service worker (vía chrome.runtime.sendMessage):
 *   { from:"offscreen", type:"upload-result", ok, taskUrl?, taskTitle?, error? }
 */

let mediaRecorder = null;
let chunks = [];
let stream = null;
let ctx = null; // {meetingUrl, meetingTitle, hubUrl, apiKey}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "start-recording") {
    void startRecording(msg);
  } else if (msg.type === "stop-recording") {
    stopRecording();
  }
});

async function startRecording(opts) {
  ctx = {
    meetingUrl: opts.meetingUrl ?? "",
    meetingTitle: opts.meetingTitle ?? "Reunión",
    hubUrl: opts.hubUrl,
    apiKey: opts.apiKey
  };

  try {
    // getUserMedia con el streamId que el service worker preparó
    // vía chrome.tabCapture.getMediaStreamId. Estos constraints son
    // específicos de Chrome — la propiedad "mandatory" no es estándar
    // pero es como se hace para tabCapture en MV3.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: opts.streamId
        }
      },
      video: false
    });
  } catch (e) {
    return reportError(`No se pudo capturar el audio de la pestaña: ${e.message}`);
  }

  // ¡OJO! Al capturar audio de la tab Chrome MUTEA la salida por
  // defecto — la reunión deja de oírse en los altavoces. Conectamos
  // el stream a un nuevo AudioContext para reproducirlo localmente
  // mientras también lo grabamos. Y de paso colgamos un AnalyserNode
  // que detecta silencio prolongado: si la reunión "termina" porque
  // se desconectaron todos, llevamos N minutos sin audio → el
  // background pregunta al user si quiere parar y subir.
  try {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    // Muestreo cada 5s. Notificamos al SW del nivel de audio (0-255)
    // y él decide qué hacer (umbral + ventana). Aquí no hacemos
    // lógica de negocio, solo sensores.
    const sampleInterval = setInterval(() => {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        clearInterval(sampleInterval);
        return;
      }
      analyser.getByteTimeDomainData(buf);
      // RMS — más estable que peak para detectar silencio.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.round(rms * 1000); // 0-1000 aprox
      chrome.runtime.sendMessage({
        from: "offscreen",
        type: "audio-level",
        level
      }).catch(() => {});
    }, 5000);
  } catch {
    // Si falla, al menos seguimos grabando — el user solo oye mal.
  }

  // Elegimos un mime que MediaRecorder soporte bien. webm/opus es el
  // más universal en Chrome.
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
  } catch (e) {
    return reportError(`MediaRecorder no se pudo crear: ${e.message}`);
  }
  chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = onStop;
  mediaRecorder.onerror = (e) => reportError(`MediaRecorder error: ${e.error?.message ?? e}`);

  // Pedimos datos cada 5s para que ondataavailable se dispare y no
  // perdamos todo si Chrome decide cerrar la pestaña inesperadamente.
  mediaRecorder.start(5000);
}

function stopRecording() {
  if (!mediaRecorder) return;
  try {
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch {
    // ignore
  }
}

async function onStop() {
  // Apagar tracks para que Chrome libere el indicador rojo de
  // "grabando" en la pestaña.
  try {
    stream?.getTracks().forEach((t) => t.stop());
  } catch {}

  if (chunks.length === 0) {
    return reportError("No se grabó audio (¿micrófono silenciado o pestaña sin sonido?)");
  }

  const mime = mediaRecorder?.mimeType ?? "audio/webm";
  const blob = new Blob(chunks, { type: mime });

  // Subir al Hub
  try {
    const form = new FormData();
    form.append("audio", blob, `meeting-${Date.now()}.webm`);
    form.append("meetingUrl", ctx.meetingUrl);
    form.append("meetingTitle", ctx.meetingTitle);
    form.append("durationMs", String(approxDurationMs(blob.size)));

    const resp = await fetch(`${ctx.hubUrl.replace(/\/$/, "")}/api/v1/extension/upload-recording`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`
      },
      body: form
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Hub respondió ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    chrome.runtime.sendMessage({
      from: "offscreen",
      type: "upload-result",
      ok: true,
      taskUrl: data.taskUrl ?? null,
      taskTitle: data.taskTitle ?? null
    });
  } catch (e) {
    reportError(`Subida fallida: ${e.message}`);
  }
}

function reportError(msg) {
  chrome.runtime.sendMessage({
    from: "offscreen",
    type: "upload-result",
    ok: false,
    error: msg
  });
}

// Estimación grosera para informar al backend cuánto duró
// (64kbps ≈ 8KB/s). Sirve como hint, no como dato exacto.
function approxDurationMs(bytes) {
  return Math.round((bytes / 8000) * 1000);
}
