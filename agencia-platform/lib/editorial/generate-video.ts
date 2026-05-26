/**
 * Generación de VÍDEO para publicaciones del calendario editorial.
 *
 * Reutiliza el MISMO contexto de marca que generate-image (brandBrief +
 * styleGuideCached + brandColors + copy del post + imagePrompt
 * estructurado si existe) — las instrucciones que David afinó durante
 * horas para que los reels/vídeos salgan a su gusto viven en esos
 * campos del cliente, así que el vídeo hereda el mismo "look".
 *
 * Motor: fal.ai (https://fal.ai) que hace de proxy a los mejores
 * modelos de vídeo (Veo 3, Kling, Luma, etc.). Una sola API key
 * (FAL_KEY) da acceso a todos. El modelo se elige con FAL_VIDEO_MODEL
 * (default kling v2 text-to-video, buen equilibrio calidad/precio).
 *
 * Flujo async (los modelos de vídeo tardan 1-5 min):
 *   1. POST a la cola de fal → request_id
 *   2. Polling del status hasta COMPLETED (o timeout)
 *   3. Descargar el .mp4 resultante, subir a R2, adjuntar al post
 *
 * Si FAL_KEY no está configurado, lanza error claro — el caller lo
 * reporta al user para que lo añada en Railway env.
 */

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { prisma } from "@/lib/db/prisma";
import { isStorageEnabled, uploadBuffer, signedDownloadUrl, buildS3Key } from "@/lib/storage/r2";
import { logAiUsage } from "@/lib/ai/usage";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { generateFreepikKlingVideo } from "@/lib/ai/freepik";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";
import { completeJson } from "@/lib/ai/anthropic";
import { openaiImagesEdits } from "./generate-image";

const execFileAsync = promisify(execFile);

async function getFfmpegPath(): Promise<string> {
  const p = ((await import("ffmpeg-static")) as any).default as string;
  if (!p) throw new Error("ffmpeg-static no disponible");
  return p;
}

/** Lee duración (s) y resolución de un fichero con ffmpeg (ffmpeg-static no
 *  trae ffprobe, así que parseamos el stderr de `ffmpeg -i`). */
async function probeMedia(ffmpegPath: string, file: string): Promise<{ dur: number; w: number; h: number }> {
  let stderr = "";
  try {
    const r = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", file], { maxBuffer: 4 << 20 });
    stderr = r.stderr || "";
  } catch (e: any) {
    // `ffmpeg -i` sin salida termina con código 1; el stderr trae la info.
    stderr = e?.stderr || "";
  }
  let dur = 0;
  const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (dm) dur = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + parseFloat(dm[3]);
  let w = 0;
  let h = 0;
  const rm = /,\s*(\d{2,5})x(\d{2,5})[\s,]/.exec(stderr);
  if (rm) {
    w = Number(rm[1]);
    h = Number(rm[2]);
  }
  return { dur, w, h };
}

/** Genera el guion de la VOZ EN OFF (español) ajustado a la duración del
 *  vídeo. Hereda el contexto de marca para mantener el tono del cliente. */
async function generateNarration(opts: {
  workspaceId: string;
  postTitle: string;
  postContent?: string | null;
  brandBrief?: string | null;
  styleGuide?: string | null;
  extraGuidance?: string | null;
  targetWords: number;
}): Promise<string> {
  const r = await completeJson<{ script: string }>({
    workspaceId: opts.workspaceId,
    system:
      `Eres copywriter de vídeo para redes sociales. Escribe la VOZ EN OFF (locución) en ESPAÑOL ` +
      `para un reel/vídeo de marca. Debe sonar natural al hablarse, ser persuasiva y caber en ~${opts.targetWords} ` +
      `palabras (NI UNA más, mejor algo menos). Una sola voz, frases cortas, sin emojis, sin hashtags, ` +
      `sin indicaciones de escena ni acotaciones — SOLO el texto que se locuta. Respeta el tono de la marca.`,
    user: [
      `Título: ${opts.postTitle}`,
      opts.postContent?.trim() ? `Mensaje del post: ${opts.postContent.slice(0, 800)}` : "",
      opts.brandBrief?.trim() ? `Marca: ${opts.brandBrief.slice(0, 500)}` : "",
      opts.styleGuide?.trim() ? `Estilo: ${opts.styleGuide.slice(0, 500)}` : "",
      opts.extraGuidance?.trim() ? `Dirección extra: ${opts.extraGuidance.slice(0, 300)}` : ""
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000),
    schema: {
      type: "object",
      properties: { script: { type: "string", description: "El texto exacto de la voz en off, en español" } },
      required: ["script"]
    },
    maxTokens: 600,
    feature: "editorial_video_narration"
  } as any);
  return (r?.script ?? "").trim();
}

/** Transcribe el audio con Whisper (verbose_json) para obtener segmentos con
 *  timestamps — así los subtítulos quedan sincronizados con la locución real. */
async function transcribeSegments(
  workspaceId: string,
  audio: Buffer
): Promise<{ start: number; end: number; text: string }[]> {
  const apiKey = await getOpenAiKeyForWorkspace(workspaceId);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "voice.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("language", "es");
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const segs = Array.isArray(data?.segments) ? data.segments : [];
  return segs
    .map((s: any) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || "").trim() }))
    .filter((s: any) => s.text);
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(mmm, 3)}`;
}

function buildSrt(segments: { start: number; end: number; text: string }[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.replace(/\s+/g, " ").trim()}\n`)
    .join("\n");
}

/** Subtítulos estimados cuando NO hay audio (voz fallida/desactivada): reparte
 *  el guion en bloques cortos a lo largo de la duración del vídeo. */
function estimateSrt(script: string, totalDur: number): string {
  const words = script.split(/\s+/).filter(Boolean);
  if (!words.length || totalDur <= 0) return "";
  const perCue = 7;
  const cues: string[][] = [];
  for (let i = 0; i < words.length; i += perCue) cues.push(words.slice(i, i + perCue));
  const each = totalDur / cues.length;
  const segs = cues.map((w, i) => ({ start: i * each, end: Math.min(totalDur, (i + 1) * each - 0.05), text: w.join(" ") }));
  return buildSrt(segs);
}

/**
 * Aplica VOZ EN OFF (ElevenLabs) y SUBTÍTULOS quemados sobre el vídeo base.
 * Whisper da los timestamps de los subtítulos para que casen con la voz real.
 * Degrada con elegancia: si la voz falla (p.ej. ElevenLabs sin configurar),
 * sigue con subtítulos de timing estimado. Devuelve changed=false si no pudo
 * aplicar nada (para que el caller no suba un duplicado del clip original).
 */
async function addVoiceAndSubtitles(opts: {
  workspaceId: string;
  baseVideo: Buffer;
  wantVoice: boolean;
  wantSubs: boolean;
  vertical: boolean;
  postTitle: string;
  postContent?: string | null;
  brandBrief?: string | null;
  styleGuide?: string | null;
  extraGuidance?: string | null;
  voiceId?: string;
}): Promise<{ buf: Buffer; note: string; changed: boolean }> {
  const ffmpegPath = await getFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), "voice-"));
  let note = "";
  try {
    const basePath = join(dir, "base.mp4");
    await writeFile(basePath, opts.baseVideo);
    const { dur: baseDur, h } = await probeMedia(ffmpegPath, basePath);
    const vDur = baseDur > 0 ? baseDur : 5;

    // El guion se dimensiona a ~2.2 palabras/seg (locución pausada) para que
    // la voz no se pase de largo del vídeo.
    const targetWords = Math.max(8, Math.round(vDur * 2.2));
    const script = await generateNarration({
      workspaceId: opts.workspaceId,
      postTitle: opts.postTitle,
      postContent: opts.postContent,
      brandBrief: opts.brandBrief,
      styleGuide: opts.styleGuide,
      extraGuidance: opts.extraGuidance,
      targetWords
    });
    if (!script) return { buf: opts.baseVideo, note: " (Sin guion para voz/subtítulos.)", changed: false };

    // 1) Voz en off (ElevenLabs).
    let audioBuf: Buffer | null = null;
    if (opts.wantVoice) {
      try {
        audioBuf = await elevenlabsSynthesize({ workspaceId: opts.workspaceId, text: script, voiceId: opts.voiceId, languageCode: "es" });
        logAiUsage({
          workspaceId: opts.workspaceId,
          feature: "editorial_video_voiceover",
          provider: "elevenlabs",
          model: "tts",
          inputTokens: 0,
          outputTokens: 0
        }).catch(() => {});
      } catch (e: any) {
        note += ` (Voz en off omitida: ${String(e?.message ?? e).slice(0, 100)}.)`;
        audioBuf = null;
      }
    }

    // 2) Subtítulos: timestamps reales de la voz (Whisper) o estimados.
    let srt = "";
    if (opts.wantSubs) {
      if (audioBuf) {
        try {
          const segs = await transcribeSegments(opts.workspaceId, audioBuf);
          srt = segs.length ? buildSrt(segs) : estimateSrt(script, vDur);
          logAiUsage({
            workspaceId: opts.workspaceId,
            feature: "editorial_video_subtitles",
            provider: "openai",
            model: "whisper-1",
            inputTokens: 0,
            outputTokens: 0
          }).catch(() => {});
        } catch {
          srt = estimateSrt(script, vDur);
        }
      } else {
        srt = estimateSrt(script, vDur);
      }
    }

    if (!audioBuf && !srt) return { buf: opts.baseVideo, note, changed: false };

    // 3) Montaje final con ffmpeg: muxea la voz y quema los subtítulos.
    let audioDur = 0;
    if (audioBuf) {
      const audioPath = join(dir, "voice.mp3");
      await writeFile(audioPath, audioBuf);
      audioDur = (await probeMedia(ffmpegPath, audioPath)).dur;
    }
    let srtName = "";
    if (srt) {
      srtName = "subs.srt";
      await writeFile(join(dir, srtName), srt);
    }

    const target = Math.max(vDur, audioDur) + (audioBuf ? 0.3 : 0);
    const vfParts: string[] = [];
    if (audioDur > vDur + 0.05) {
      // Congela el último fotograma para que la voz se oiga entera.
      vfParts.push(`tpad=stop_mode=clone:stop_duration=${(audioDur - vDur).toFixed(2)}`);
    }
    if (srtName) {
      const fontSize = Math.max(18, Math.round((h > 0 ? h : opts.vertical ? 1280 : 720) * 0.05));
      const marginV = Math.max(24, Math.round((h > 0 ? h : opts.vertical ? 1280 : 720) * 0.08));
      const style = `Fontname=Arial,Fontsize=${fontSize},PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=${marginV}`;
      vfParts.push(`subtitles=${srtName}:force_style='${style}'`);
    }
    const hasVf = vfParts.length > 0;
    const outPath = join(dir, "final.mp4");
    const args: string[] = ["-y", "-i", "base.mp4"];
    if (audioBuf) args.push("-i", "voice.mp3");
    if (hasVf) args.push("-vf", vfParts.join(","));
    args.push("-map", "0:v");
    if (audioBuf) args.push("-map", "1:a");
    if (hasVf) args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
    else args.push("-c:v", "copy");
    if (audioBuf) args.push("-c:a", "aac", "-b:a", "128k");
    else args.push("-an");
    args.push("-movflags", "+faststart", "-t", target.toFixed(2), outPath);

    await execFileAsync(ffmpegPath, args, { cwd: dir, maxBuffer: 64 << 20 });
    const buf = await readFile(outPath);
    const bits = [audioBuf ? "voz en off" : null, srt ? "subtítulos" : null].filter(Boolean).join(" + ");
    return { buf, note: `${bits ? ` Con ${bits}.` : ""}${note}`, changed: true };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Une N clips .mp4 (las tomas) en un solo reel con ffmpeg. Usa el demuxer
 * `concat` (rápido, sin recodificar audio porque las tomas no llevan), pero
 * recodifica vídeo a H.264 yuv420p para que el resultado sea reproducible en
 * cualquier red social (Kling puede devolver perfiles raros). Si ffmpeg no
 * está disponible o falla, el caller hace fallback a los clips sueltos.
 */
async function stitchClips(buffers: Buffer[]): Promise<Buffer> {
  const ffmpegPath = await getFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const files: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const p = join(dir, `shot-${i}.mp4`);
      await writeFile(p, buffers[i]);
      files.push(p);
    }
    // Lista para el demuxer concat. Las rutas van entre comillas simples y
    // -safe 0 permite rutas absolutas.
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, files.map((f) => `file '${f}'`).join("\n"));
    const outPath = join(dir, "reel.mp4");

    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outPath
      ],
      { maxBuffer: 1024 * 1024 * 64 }
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Genera una imagen de toma con gpt-image-2 (mismo motor que las imágenes
 *  de las publicaciones). Devuelve el Buffer PNG. */
async function generateShotImage(workspaceId: string, prompt: string, size: string): Promise<Buffer> {
  const apiKey = await getOpenAiKeyForWorkspace(workspaceId);
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size, n: 1, quality: "high" })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`gpt-image-2 ${resp.status}: ${t.slice(0, 200)}`);
  }
  const j = await resp.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-2 no devolvió imagen");
  return Buffer.from(b64, "base64");
}

/** Resuelve hasta 5 URLs de referencia de las personas indicadas en
 *  forceRosterPersons a partir del roster del cliente (client.referenceImages).
 *  Distribución: 1 persona → 2 fotos; 2 → 4; 3 → 5; 4+ → 5 (1 por persona).
 *  Si no hay forceRosterPersons o no hay matches, devuelve []. */
function resolveShotReferenceUrls(client: any, forceRosterPersons: string[]): string[] {
  if (!forceRosterPersons || forceRosterPersons.length === 0) return [];
  const refs: any[] = Array.isArray(client?.referenceImages) ? client.referenceImages : [];
  const peopleByName = new Map<string, string[]>();
  for (const r of refs) {
    const name = (r?.personName ?? "").toString().trim();
    const url = typeof r?.url === "string" ? r.url : null;
    if (!name || !url) continue;
    if (!peopleByName.has(name)) peopleByName.set(name, []);
    peopleByName.get(name)!.push(url);
  }
  const forcedLower = forceRosterPersons.map((n) => n.toLowerCase().trim()).filter(Boolean);
  const names = Array.from(peopleByName.keys()).filter((n) => forcedLower.includes(n.toLowerCase()));
  const TOTAL_CAP = 5;
  const perPerson = names.length >= 4 ? 1 : 2;
  const urls: string[] = [];
  for (const name of names) {
    const list = peopleByName.get(name) ?? [];
    for (const u of list.slice(0, perPerson)) {
      if (urls.length < TOTAL_CAP) urls.push(u);
    }
  }
  return urls;
}

/** Genera la imagen de una toma usando gpt-image-2 /edits con fotos del
 *  roster como referencia (mismo camino que el pipeline de imagen). Esto
 *  es lo que permite que Rochar (u otras personas reales) salgan con su
 *  cara real, no inventada. Si no hay refs, hace fallback a text-to-image. */
async function generateShotImageWithRefs(
  workspaceId: string,
  prompt: string,
  size: string,
  referenceUrls: string[]
): Promise<Buffer> {
  if (referenceUrls.length === 0) {
    return generateShotImage(workspaceId, prompt, size);
  }
  const apiKey = await getOpenAiKeyForWorkspace(workspaceId);
  const augmented =
    prompt +
    " Match the identity, facial features and overall look of the people in the provided reference images.";
  return openaiImagesEdits({
    apiKey,
    prompt: augmented,
    size,
    // "medium" en lugar de "high": la imagen se ANIMA después con Kling, así
    // que las diferencias finas se pierden de todos modos, y "medium" reduce
    // mucho la tasa de 502 transitorios de OpenAI /edits con 5 refs (que
    // pueden tardar 90-150s en "high").
    quality: "medium",
    referenceUrls
  });
}

const STORYBOARD_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          image_prompt: { type: "string", description: "Prompt EN INGLÉS para gpt-image-2 de la toma (escena, sujeto, ambiente, luz)" },
          motion: { type: "string", description: "Movimiento de cámara/sujeto para animar la toma (corto, EN INGLÉS)" }
        },
        required: ["image_prompt", "motion"]
      }
    }
  },
  required: ["shots"]
};

/**
 * Construye el prompt de vídeo a partir del contexto de marca + copy.
 * Mismo enfoque que generate-image pero con directivas de movimiento
 * (cámara, ritmo, duración) propias del vídeo.
 */
function buildVideoPrompt(opts: {
  postTitle: string;
  postContent?: string | null;
  storedImagePrompt?: string | null;
  brandBrief?: string | null;
  styleGuide?: string | null;
  brandColorPrimary?: string | null;
  brandColorAccent?: string | null;
  extraGuidance?: string | null;
  format?: string;
}): string {
  // Si hay imagePrompt estructurado (de generate-month, afinado por
  // David), lo usamos como base visual — ya describe sujeto, ambiente,
  // personas del roster, etc. Le añadimos directivas de movimiento.
  if (opts.storedImagePrompt && opts.storedImagePrompt.length > 50) {
    return [
      opts.storedImagePrompt,
      "",
      "=== MOVIMIENTO / VÍDEO ===",
      "Cinematic motion: smooth camera movement (slow push-in or gentle pan),",
      "natural subject movement, professional commercial pacing.",
      opts.format === "reel" || opts.format === "story"
        ? "Vertical 9:16 format, dynamic and scroll-stopping for Reels/Stories."
        : "Horizontal 16:9, polished brand video.",
      "Realistic lighting, no on-screen text (el copy va aparte)."
    ].join("\n");
  }

  const parts: string[] = [
    `Brand video for a social media post titled "${opts.postTitle}".`
  ];
  if (opts.brandBrief?.trim()) parts.push(`About the brand: ${opts.brandBrief.slice(0, 600)}.`);
  if (opts.styleGuide?.trim()) parts.push(`Brand style: ${opts.styleGuide.slice(0, 800)}.`);
  if (opts.brandColorPrimary) {
    parts.push(`Brand colors: primary ${opts.brandColorPrimary}${opts.brandColorAccent ? `, accent ${opts.brandColorAccent}` : ""}.`);
  }
  if (opts.postContent?.trim()) parts.push(`Topic / message: ${opts.postContent.slice(0, 300)}.`);
  if (opts.extraGuidance?.trim()) parts.push(`Extra direction: ${opts.extraGuidance.slice(0, 300)}.`);
  parts.push(
    "=== VIDEO DIRECTION ===",
    "Cinematic, professional commercial look. Smooth camera motion,",
    "natural subject movement, vivid brand-consistent color grade,",
    opts.format === "reel" || opts.format === "story"
      ? "vertical 9:16 for Reels/Stories, dynamic and scroll-stopping."
      : "horizontal 16:9 polished brand video.",
    "Realistic lighting. NO on-screen text or captions (el copy se añade aparte)."
  );
  return parts.filter(Boolean).join("\n");
}

export async function generatePostVideo(opts: {
  workspaceId: string;
  postId: string;
  /** Override del prompt base (si David quiere guiar el storyboard). */
  promptOverride?: string;
  /** Guidance extra del user para este vídeo concreto. */
  extraGuidance?: string;
  /** Slug del modelo de vídeo de Freepik (default kling-v2). */
  model?: string;
  /** Nº de tomas (default 2, máx 4). */
  shots?: number;
  /** Añadir voz en off (ElevenLabs). Default true. */
  voiceover?: boolean;
  /** Quemar subtítulos en el vídeo. Default true. */
  subtitles?: boolean;
  /** Voz de ElevenLabs a usar (default: la configurada en el workspace). */
  voiceId?: string;
  /** Personas del roster del cliente que DEBEN aparecer en las tomas. Si
   *  se pasa, las imágenes de cada toma se generan con gpt-image-2 /edits
   *  usando las fotos reales del roster como referencia, igual que el
   *  pipeline de imagen. Si está vacío, fallback a generación text-to-image. */
  forceRosterPersons?: string[];
}): Promise<{ videoUrls: string[]; shots: number; note: string }> {
  if (!isStorageEnabled()) {
    throw new Error("STORAGE_* no configurado — no se pueden guardar vídeos generados");
  }

  const post = await prisma.editorialPost.findFirst({
    where: { id: opts.postId, workspaceId: opts.workspaceId },
    include: { client: true }
  });
  if (!post) throw new Error(`Post ${opts.postId} no existe en este workspace`);
  const client: any = post.client;

  const format = (post as any).format ?? "reel";
  const vertical = format === "reel" || format === "story";
  const imageSize = vertical ? "1024x1536" : "1536x1024";
  const aspectRatio = vertical ? "9:16" : "16:9";
  const nShots = Math.max(1, Math.min(opts.shots ?? 2, 4));

  const baseCtx = buildVideoPrompt({
    postTitle: post.title,
    postContent: post.content,
    storedImagePrompt: (post as any).imagePrompt,
    brandBrief: client?.brandBrief,
    styleGuide: client?.styleGuideCached,
    brandColorPrimary: client?.brandColorPrimary,
    brandColorAccent: client?.brandColorAccent,
    extraGuidance: opts.extraGuidance,
    format
  });

  // 1) Storyboard: dividir la publicación en N tomas (imagen + movimiento).
  let shots: { image_prompt: string; motion: string }[] = [];
  try {
    const sb = await completeJson<{ shots: { image_prompt: string; motion: string }[] }>({
      workspaceId: opts.workspaceId,
      system:
        `Eres director creativo de vídeo para redes sociales. Divide la publicación en ${nShots} TOMAS ` +
        `coherentes (storyboard). Para cada toma da un image_prompt EN INGLÉS detallado y listo para gpt-image-2 ` +
        `(escena, sujeto descrito físicamente sin nombres propios, ambiente, luz, encajado en ${aspectRatio}, ` +
        `SIN texto sobreimpreso) y un 'motion' corto en inglés (movimiento de cámara/sujeto). Mantén coherencia ` +
        `de marca y del MISMO personaje entre tomas.`,
      user: (opts.promptOverride?.trim() || baseCtx).slice(0, 6000),
      schema: STORYBOARD_SCHEMA,
      maxTokens: 2000,
      feature: "editorial_video_storyboard"
    } as any);
    shots = Array.isArray(sb?.shots) ? sb.shots.slice(0, nShots) : [];
  } catch {
    shots = [];
  }
  if (shots.length === 0) {
    shots = [{ image_prompt: baseCtx, motion: "slow cinematic push-in, natural subject movement" }];
  }

  // 2) Por cada toma: imagen con gpt-image-2 → vídeo con Freepik/Kling.
  // Si el modal forzó personas del roster, las imágenes se generan con
  // /v1/images/edits + fotos reales como referencia, así Rochar (etc.)
  // aparece con su cara real en cada toma, no inventada.
  const shotRefUrls = resolveShotReferenceUrls(client, opts.forceRosterPersons ?? []);
  if (shotRefUrls.length > 0) {
    console.log(`[generate-video] usando ${shotRefUrls.length} fotos de referencia del roster para las tomas`);
  }
  const videoUrls: string[] = [];
  const imageUrls: string[] = [];
  const clipBuffers: Buffer[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const imgBuf = await generateShotImageWithRefs(opts.workspaceId, shot.image_prompt, imageSize, shotRefUrls);
    const imgKey = buildS3Key({
      workspaceId: opts.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `shot-${i + 1}-${Date.now()}.png`
    });
    await uploadBuffer({ s3Key: imgKey, body: imgBuf, contentType: "image/png" });
    imageUrls.push(await signedDownloadUrl(imgKey));
    logAiUsage({
      workspaceId: opts.workspaceId,
      feature: "editorial_video_frame",
      provider: "openai",
      model: "gpt-image-2",
      inputTokens: 0,
      outputTokens: 0
    }).catch(() => {});

    const { url: clipUrl, model } = await generateFreepikKlingVideo({
      workspaceId: opts.workspaceId,
      imageBase64: imgBuf.toString("base64"),
      prompt: shot.motion || "cinematic motion",
      durationSeconds: 5,
      modelSlug: opts.model
    });
    const vresp = await fetch(clipUrl);
    if (!vresp.ok) throw new Error(`No pude descargar la toma ${i + 1}: ${vresp.status}`);
    const vbuf = Buffer.from(await vresp.arrayBuffer());
    clipBuffers.push(vbuf);
    const vKey = buildS3Key({
      workspaceId: opts.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `video-shot-${i + 1}-${Date.now()}.mp4`
    });
    await uploadBuffer({ s3Key: vKey, body: vbuf, contentType: "video/mp4" });
    videoUrls.push(await signedDownloadUrl(vKey));
    logAiUsage({
      workspaceId: opts.workspaceId,
      feature: "editorial_video",
      provider: "freepik",
      model: `freepik:${model}`,
      inputTokens: 0,
      outputTokens: 0
    }).catch(() => {});
  }

  // 3) Componer el vídeo final: montar las tomas en 1 reel (si hay varias) y
  // añadir voz en off + subtítulos. El resultado va primero en la galería del
  // post; los clips sueltos y las imágenes quedan detrás como respaldo. Cada
  // paso degrada con elegancia (si ffmpeg/voz fallan, seguimos con lo que haya).
  let composite: Buffer | null = null;
  let buildNote = "";

  // 3a) Montaje de las tomas.
  if (clipBuffers.length > 1) {
    try {
      composite = await stitchClips(clipBuffers);
      buildNote += " Montadas en 1 reel.";
    } catch (e: any) {
      buildNote += ` (No se pudo montar el reel: ${String(e?.message ?? e).slice(0, 120)}; quedan los clips sueltos.)`;
    }
  }

  // 3b) Voz en off + subtítulos sobre el vídeo base (reel montado o clip único).
  const wantVoice = opts.voiceover !== false;
  const wantSubs = opts.subtitles !== false;
  if ((wantVoice || wantSubs) && (composite || clipBuffers.length === 1)) {
    const base = composite ?? clipBuffers[0];
    try {
      const enhanced = await addVoiceAndSubtitles({
        workspaceId: opts.workspaceId,
        baseVideo: base,
        wantVoice,
        wantSubs,
        vertical,
        postTitle: post.title,
        postContent: post.content,
        brandBrief: client?.brandBrief,
        styleGuide: client?.styleGuideCached,
        extraGuidance: opts.extraGuidance,
        voiceId: opts.voiceId
      });
      buildNote += enhanced.note;
      if (enhanced.changed) composite = enhanced.buf;
    } catch (e: any) {
      buildNote += ` (Voz/subtítulos no aplicados: ${String(e?.message ?? e).slice(0, 120)}.)`;
    }
  }

  // 3c) Subir el vídeo compuesto (si lo hay).
  let finalUrl: string | null = null;
  if (composite) {
    const reelKey = buildS3Key({
      workspaceId: opts.workspaceId,
      targetType: "editorial",
      targetId: post.id,
      filename: `reel-${Date.now()}.mp4`
    });
    await uploadBuffer({ s3Key: reelKey, body: composite, contentType: "video/mp4" });
    finalUrl = await signedDownloadUrl(reelKey);
  }

  // 4) Adjuntar al post: vídeo compuesto (si hay) → clips de cada toma →
  // imágenes de cada toma → lo que ya hubiera.
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(post.mediaUrls);
    if (!Array.isArray(mediaUrls)) mediaUrls = [];
  } catch {
    mediaUrls = [];
  }
  mediaUrls = [...(finalUrl ? [finalUrl] : []), ...videoUrls, ...imageUrls, ...mediaUrls];
  await prisma.editorialPost.update({
    where: { id: post.id },
    data: { mediaUrls: JSON.stringify(mediaUrls) }
  });

  return {
    videoUrls: finalUrl ? [finalUrl, ...videoUrls] : videoUrls,
    shots: shots.length,
    note: `${shots.length} toma(s) ${aspectRatio}: imagen (gpt-image-2) → vídeo (Freepik/Kling).${buildNote} ${videoUrls.length} clip(s) adjuntado(s) al post.`
  };
}
