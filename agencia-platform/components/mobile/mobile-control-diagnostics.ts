export function mobileControlPermissionError(line: string): string | null {
  if (!/INJECT_EVENTS|Injecting (?:input )?events.*permission/i.test(line)) return null;
  return "Android permite ver la pantalla, pero está bloqueando las pulsaciones. En Xiaomi, revisa en el teléfono Opciones de desarrollador → Depuración USB (Ajustes de seguridad); es un permiso distinto de Depuración USB. Después de autorizarlo, reinicia el móvil y vuelve a conectar la pantalla.";
}

export async function discardMobileClipboard(
  output: { getReader: () => { read: () => Promise<{ done: boolean }>; releaseLock: () => void } }
): Promise<void> {
  const reader = output.getReader();
  try {
    while (!(await reader.read()).done) { /* Do not store or sync phone clipboard content. */ }
  } finally {
    reader.releaseLock();
  }
}

export async function readMobileControlOutput(
  output: { getReader: () => { read: () => Promise<{ done: boolean; value?: string }>; releaseLock: () => void } },
  report: (message: string) => void
): Promise<void> {
  const reader = output.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      const error = mobileControlPermissionError(value ?? "");
      if (error) report(error);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Lee las notificaciones de portapapeles del móvil sin guardarlas, salvo durante
 * una captura explícita (p. ej. «Copiar enlace» de un comentario recién publicado).
 */
export function createClipboardWatcher(
  output: { getReader: () => { read: () => Promise<{ done: boolean; value?: unknown }>; releaseLock: () => void } }
) {
  const state: { waiting: ((value: string) => void) | null } = { waiting: null };
  const done = (async () => {
    const reader = output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (state.waiting && typeof value === "string") { const resolve = state.waiting; state.waiting = null; resolve(value); }
      }
    } finally { reader.releaseLock(); }
  })();
  return {
    done,
    async capture(action: () => Promise<void>, timeoutMs: number): Promise<string | null> {
      const copied = new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => { if (state.waiting === finish) state.waiting = null; resolve(null); }, timeoutMs);
        const finish = (value: string) => { clearTimeout(timer); resolve(value); };
        state.waiting = finish;
      });
      await action();
      return copied;
    }
  };
}
