/**
 * Cola GLOBAL de voz de Sonia (cliente). Garantiza que NUNCA suenen dos
 * voces a la vez en toda la app, sin importar qué componente las dispare
 * (tablero de Tareas, notificador de llamadas, aviso de Meta, etc.).
 *
 * Todo audio/voz de Sonia debe pasar por aquí: encadena las reproducciones
 * en serie (una espera a que termine la anterior) y, por seguridad, corta
 * cualquier reproducción en curso antes de empezar la siguiente.
 */

let chain: Promise<void> = Promise.resolve();
let current: HTMLAudioElement | null = null;

function stopCurrent() {
  try {
    if (current) {
      current.pause();
      current.src = "";
      current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
}

function run(task: () => Promise<void>): Promise<void> {
  const next = chain.catch(() => {}).then(task);
  // Mantén la cadena viva aunque una tarea falle.
  chain = next.catch(() => {});
  return next;
}

/** Reproduce un MP3/audio desde una URL, en serie. */
export function playSoniaUrl(url: string): Promise<void> {
  return run(
    () =>
      new Promise<void>((resolve) => {
        try {
          stopCurrent();
          const audio = new Audio(url);
          current = audio;
          const done = () => {
            if (current === audio) current = null;
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.play().catch(done);
        } catch {
          resolve();
        }
      })
  );
}

/** Reproduce un Blob de audio (crea y libera el objectURL), en serie. */
export function playSoniaBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  return run(
    () =>
      new Promise<void>((resolve) => {
        try {
          stopCurrent();
          const audio = new Audio(url);
          current = audio;
          const done = () => {
            if (current === audio) current = null;
            try {
              URL.revokeObjectURL(url);
            } catch {
              /* noop */
            }
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.play().catch(done);
        } catch {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* noop */
          }
          resolve();
        }
      })
  );
}

/** Voz del navegador (fallback TTS), también en serie con el resto. */
export function speakSonia(text: string, lang = "es-ES"): Promise<void> {
  return run(
    () =>
      new Promise<void>((resolve) => {
        try {
          stopCurrent();
          const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
          if (!synth) {
            resolve();
            return;
          }
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          synth.speak(u);
        } catch {
          resolve();
        }
      })
  );
}

/** Corta todo y vacía la cola (p. ej. al desmontar / cambiar de página). */
export function stopAllSonia() {
  stopCurrent();
  chain = Promise.resolve();
}
