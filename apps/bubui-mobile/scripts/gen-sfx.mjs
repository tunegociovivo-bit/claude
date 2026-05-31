/**
 * Genera los efectos de sonido de Bubui como WAV pequeños (16-bit mono,
 * 44.1kHz) — sin depender de assets externos ni licencias. Reproducible:
 *   node scripts/gen-sfx.mjs
 * Salida en assets/sfx/{tap,success,coin}.wav
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sfx");
mkdirSync(OUT, { recursive: true });

// Envolvente: ataque corto (evita clicks) + caída exponencial.
function env(t, dur, attack = 0.005, decay = 18) {
  const a = Math.min(1, t / attack);
  const d = Math.exp(-(t) * decay);
  // Fundido final para llegar a 0 limpio.
  const fade = Math.min(1, (dur - t) / 0.01);
  return a * d * Math.max(0, fade);
}

function sine(f, t) { return Math.sin(2 * Math.PI * f * t); }
function tri(f, t) { return (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t)); }

// Mezcla una lista de notas {freq, start, dur, gain, wave, decay} en un buffer.
function render(notes, totalDur) {
  const n = Math.floor(SR * totalDur);
  const buf = new Float32Array(n);
  for (const note of notes) {
    const wave = note.wave === "tri" ? tri : sine;
    const start = Math.floor(note.start * SR);
    const len = Math.floor(note.dur * SR);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= n) break;
      const t = i / SR;
      buf[idx] += wave(note.freq, t) * env(t, note.dur, note.attack ?? 0.005, note.decay ?? 18) * (note.gain ?? 1);
    }
  }
  // Normaliza a 0.8 de pico.
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < n; i++) buf[i] = (buf[i] / peak) * 0.8;
  return buf;
}

function toWav(buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return data;
}

// Notas (Hz)
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, B5 = 987.77, E6 = 1318.51;

// tap: tick suave y muy corto.
const tap = render([{ freq: 880, start: 0, dur: 0.06, decay: 55, gain: 0.9, attack: 0.002 }], 0.07);

// success: arpegio mayor ascendente C5-E5-G5-C6 (ta-da).
const success = render([
  { freq: C5, start: 0.00, dur: 0.34, decay: 9, gain: 0.8 },
  { freq: E5, start: 0.07, dur: 0.34, decay: 9, gain: 0.8 },
  { freq: G5, start: 0.14, dur: 0.40, decay: 8, gain: 0.85 },
  { freq: C6, start: 0.21, dur: 0.45, decay: 7, gain: 0.9 }
], 0.7);

// coin: recompensa retro (B5 corto → E6 sostenido), onda triangular.
const coin = render([
  { freq: B5, start: 0.0, dur: 0.08, decay: 14, gain: 0.9, wave: "tri", attack: 0.002 },
  { freq: E6, start: 0.07, dur: 0.26, decay: 9, gain: 0.9, wave: "tri", attack: 0.002 }
], 0.34);

writeFileSync(join(OUT, "tap.wav"), toWav(tap));
writeFileSync(join(OUT, "success.wav"), toWav(success));
writeFileSync(join(OUT, "coin.wav"), toWav(coin));
console.log("OK → assets/sfx/{tap,success,coin}.wav");
