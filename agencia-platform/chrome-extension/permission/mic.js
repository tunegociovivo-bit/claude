const msg = document.getElementById("msg");
const btn = document.getElementById("grant");
async function ask() {
  btn.disabled = true;
  msg.className = "msg";
  msg.textContent = "Esperando tu permiso…";
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.className = "msg ok";
    msg.innerHTML = "✅ <b>Micrófono activado.</b> Ya puedes cerrar esta pestaña y grabar reuniones — se incluirá tu voz.";
    btn.style.display = "none";
  } catch (e) {
    msg.className = "msg err";
    msg.innerHTML =
      "❌ No se concedió (" + (e && e.name ? e.name : "error") + ").<br>" +
      "Si lo bloqueaste: pulsa el <b>candado</b> 🔒 de la barra de direcciones de ESTA pestaña → Micrófono → <b>Permitir</b>, y vuelve a pulsar el botón.";
    btn.disabled = false;
  }
}
btn.addEventListener("click", ask);
// Intento automático al abrir (si ya estaba concedido, confirma al instante).
ask();
