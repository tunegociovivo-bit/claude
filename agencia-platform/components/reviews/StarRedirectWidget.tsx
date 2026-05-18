/**
 * Landing pública con 5 estrellas — equivalente al shortcode
 * [ac_resenas] del plugin "Automatic Choice" original, pero hecho
 * React/Next y con redirect server-side.
 *
 * El usuario final entra en /r/<slug>, ve la card con 5 estrellas,
 * pulsa una → la página se recarga con ?s=N → page.tsx hace redirect
 * server-side a positiveUrl o negativeUrl según el rango.
 *
 * Estilos inline (sin Tailwind) — pensado para que el shortcode-link
 * se vea idéntico abriéndose en cualquier dispositivo, incluso si
 * el navegador del cliente tiene CSS roto. Las estrellas usan flex
 * row-reverse + ":hover ~ .ac-star" para el efecto cascada (al pasar
 * por encima de N estrellas, todas las anteriores se iluminan).
 */
"use client";

export default function StarRedirectWidget({
  slug,
  clientName
}: {
  slug: string;
  clientName: string;
}) {
  return (
    <>
      <style>{`
        .acr-card {
          max-width: 560px;
          margin: 24px auto;
          background: #ffffff;
          border-radius: 18px;
          box-shadow: 0 12px 40px rgba(0,0,0,.08);
          padding: 36px 28px;
          font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #1a1a1a;
        }
        .acr-logo {
          font-weight: 700;
          color: #0a3d62;
          letter-spacing: .5px;
          margin-bottom: 6px;
          text-align: center;
        }
        .acr-card h2 { color:#0a3d62; font-size:22px; margin:0 0 8px; text-align:center; }
        .acr-card p  { color:#444; line-height:1.5; margin:8px 0 16px; text-align:center; }
        .acr-stars {
          display: flex;
          justify-content: center;
          gap: 6px;
          margin: 20px 0 8px;
          flex-wrap: wrap;
          flex-direction: row-reverse;
        }
        .acr-star {
          font-size: 54px;
          line-height: 1;
          cursor: pointer;
          color: #d8dde4;
          text-decoration: none;
          transition: color .15s;
          user-select: none;
        }
        .acr-star:hover, .acr-star:hover ~ .acr-star { color: #fdcb6e; }
        .acr-pie { font-size: 12px; color: #888; margin-top: 18px; text-align: center; }
      `}</style>
      <div className="acr-card">
        <div className="acr-logo">{clientName}</div>
        <h2>Hola 👋</h2>
        <p>Gracias por confiar en nosotros. ¿Cómo valorarías tu experiencia?</p>
        <div className="acr-stars" role="radiogroup" aria-label="Valoración">
          {/* Renderizamos 5 → 1 para que el :hover ~ del CSS ilumine
              en cascada hacia la izquierda visualmente (orden DOM
              invertido por flex row-reverse). */}
          {[5, 4, 3, 2, 1].map((n) => (
            <a
              key={n}
              className="acr-star"
              href={`/r/${encodeURIComponent(slug)}?s=${n}`}
              role="radio"
              aria-label={`${n} estrellas`}
              title={`${n} estrellas`}
            >
              ★
            </a>
          ))}
        </div>
        <p className="acr-pie">Tu opinión nos ayuda a mejorar.</p>
      </div>
    </>
  );
}
