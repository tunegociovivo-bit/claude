import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sniffAudioFormat } from "@/lib/inbox/media-core";

const execFileAsync = promisify(execFile);

export const MAX_VOICE_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 300;

async function ffmpegPath(): Promise<string> {
  const p = ((await import("ffmpeg-static")) as any).default as string;
  if (!p) throw new Error("ffmpeg no disponible en el servidor");
  return p;
}

export class VoiceFormatError extends Error {}

// Lo que graba el navegador (webm/opus en Android y Chrome, mp4/aac en iPhone)
// se convierte a OGG/Opus mono, el formato de las notas de voz de WhatsApp.
export async function toWhatsappVoiceNote(input: Buffer): Promise<{ data: Buffer; seconds: number | null }> {
  const format = sniffAudioFormat(input);
  if (!format) throw new VoiceFormatError("El archivo no es una grabación de audio");
  const dir = await mkdtemp(path.join(os.tmpdir(), "crm-voz-"));
  try {
    const src = path.join(dir, "entrada");
    const out = path.join(dir, "nota.ogg");
    await writeFile(src, input);
    const ff = await ffmpegPath();
    const { stderr } = await execFileAsync(
      ff,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        // Solo el archivo local recién escrito: ni red ni otros protocolos.
        "-protocol_whitelist",
        "file",
        "-f",
        format,
        "-i",
        src,
        "-t",
        String(MAX_VOICE_SECONDS),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-application",
        "voip",
        out,
      ],
      { timeout: 60_000, maxBuffer: 8 << 20 }
    );
    const data = await readFile(out);
    if (data.length < 200) throw new Error("La grabación está vacía");
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    return { data, seconds: seconds && Number.isFinite(seconds) ? Math.min(seconds, MAX_VOICE_SECONDS) : null };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
