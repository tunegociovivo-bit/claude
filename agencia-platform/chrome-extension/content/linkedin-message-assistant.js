(() => {
  "use strict";
  if (document.getElementById("nv-linkedin-message-assistant")) return;

  const ask = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ from: "linkedin-prospecting", ...message }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function messageButton() {
    return [...document.querySelectorAll("main button, main a, [role='main'] button, [role='main'] a")]
      .find((element) => /^(mensaje|message)$/i.test(clean(element.textContent || element.getAttribute("aria-label"))));
  }

  async function prepareMessage(message) {
    const trigger = messageButton();
    if (!trigger) throw new Error("No encuentro el botón Mensaje en este perfil. Puede que LinkedIn no permita escribir a esta persona todavía.");
    trigger.click();
    let editor = null;
    for (let attempt = 0; attempt < 16 && !editor; attempt++) {
      await wait(300);
      editor = document.querySelector(".msg-form__contenteditable[contenteditable='true'], div[role='textbox'][contenteditable='true'], textarea[name='message']");
    }
    if (!editor) throw new Error("LinkedIn abrió la conversación, pero no encuentro el cuadro de texto.");
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      editor.value = message;
    } else {
      editor.textContent = message;
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  void (async () => {
    const response = await ask({ type: "prospecting-linkedin-draft", url: location.href });
    if (!response?.ok || !response.draft) return;
    const draft = response.draft;
    const panel = document.createElement("aside");
    panel.id = "nv-linkedin-message-assistant";
    panel.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;width:min(390px,calc(100vw - 40px));background:#fff;color:#172554;border:1px solid #93c5fd;border-radius:14px;padding:14px;font:13px/1.45 system-ui;box-shadow:0 12px 36px #0004";
    panel.innerHTML = `<div style="font-weight:750;color:#1d4ed8">NV Prospección · mensaje listo</div><div style="margin-top:3px;font-size:12px;color:#475569"></div><div style="margin-top:10px;max-height:180px;overflow:auto;white-space:pre-wrap;background:#eff6ff;border-radius:9px;padding:10px"></div><div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px"></div>`;
    panel.children[1].textContent = [draft.person, draft.company, draft.jobTitle].filter(Boolean).join(" · ");
    panel.children[2].textContent = draft.message;
    const actions = panel.children[3];
    const makeButton = (label, primary = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = `border:1px solid ${primary ? "#1d4ed8" : "#bfdbfe"};border-radius:8px;padding:7px 10px;background:${primary ? "#1d4ed8" : "#fff"};color:${primary ? "#fff" : "#1d4ed8"};font-weight:650;cursor:pointer`;
      actions.appendChild(button);
      return button;
    };
    const prepare = makeButton("Preparar en LinkedIn", true);
    const copy = makeButton("Copiar");
    const sent = makeButton("Marcar enviado");
    const close = makeButton("Cerrar");
    prepare.addEventListener("click", async () => {
      prepare.disabled = true;
      try {
        await prepareMessage(draft.message);
        prepare.textContent = "✓ Preparado · revisa y pulsa Enviar";
      } catch (error) {
        prepare.disabled = false;
        alert(error?.message || String(error));
      }
    });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(draft.message);
      copy.textContent = "✓ Copiado";
    });
    sent.addEventListener("click", async () => {
      if (!confirm("Confirma que ya has pulsado Enviar en LinkedIn. Se registrará el contacto y avanzará la cadencia.")) return;
      sent.disabled = true;
      const result = await ask({ type: "prospecting-linkedin-complete", activityId: draft.activityId });
      if (!result?.ok) {
        sent.disabled = false;
        alert(result?.error || "No se pudo registrar el envío");
        return;
      }
      panel.remove();
    });
    close.addEventListener("click", () => panel.remove());
    document.documentElement.appendChild(panel);
  })();
})();
