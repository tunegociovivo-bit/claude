/**
 * Conversión de audio para notas de voz de WhatsApp.
 *
 * WhatsApp solo acepta notas de voz (PTT) en OGG con codec OPUS. ElevenLabs
 * nos da MP3, así que lo transcodificamos aquí con ffmpeg-static (ya es
 * dependencia del proyecto y su binario va incluido en el build standalone,
 * ver next.config outputFileTracingIncludes). Así no dependemos de que el
 * servidor WAHA tenga ffmpeg ni del flag `convert:true` (que tiene bugs).
 */

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function getFfmpegPath(): Promise<string> {
  const p = ((await import("ffmpeg-static")) as any).default as string;
  if (!p) throw new Error("ffmpeg-static no disponible");
  return p;
}

/**
 * Convierte un MP3 a OGG/Opus apto para nota de voz de WhatsApp
 * (48 kHz, mono, ~32 kbps, perfil voip).
 */
export async function mp3ToOpusOgg(mp3: Buffer): Promise<Buffer> {
  const ffmpegPath = await getFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), "wa-voice-"));
  const inPath = join(dir, "in.mp3");
  const outPath = join(dir, "out.ogg");
  try {
    await writeFile(inPath, mp3);
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-y",
        "-i", inPath,
        "-c:a", "libopus",
        "-b:a", "32k",
        "-ar", "48000",
        "-ac", "1",
        "-application", "voip",
        "-f", "ogg",
        outPath
      ],
      { maxBuffer: 32 << 20 }
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
