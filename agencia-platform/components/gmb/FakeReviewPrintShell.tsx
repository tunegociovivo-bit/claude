"use client";
/** Envoltorio imprimible del informe de reseñas falsas (botón PDF + estilos de impresión). */
import type { ReactNode } from "react";

export default function FakeReviewPrintShell({ children, pdfUrl }: { children: ReactNode; pdfUrl?: string }) {
  return (
    <div className="min-h-screen bg-[#EFEAE0] py-6 px-4 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .fr-avoid { break-inside: avoid; }
          .fr-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .fr-report a { text-decoration: none; color: inherit; }
        }
      `}</style>
      <div className="max-w-5xl mx-auto mb-3 flex justify-end gap-2 print:hidden">
        {pdfUrl && (
          <a href={pdfUrl} className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-[#C9962E] hover:bg-[#16160F]">
            Descargar PDF
          </a>
        )}
        <button
          onClick={() => window.print()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-[#16160F] hover:bg-[#C9962E]"
        >
          Imprimir
        </button>
      </div>
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-sm p-5 sm:p-8 print:shadow-none print:p-0 print:rounded-none">
        {children}
      </div>
    </div>
  );
}
