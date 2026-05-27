import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  // Safelist — clases que se construyen dinámicamente con clsx() y
  // que Tailwind a veces no detecta si el class string se concatena
  // o pasa por un ternario complejo. Mantenemos aquí las que SÍ o
  // SÍ deben estar en el bundle. En concreto, los indicadores
  // visuales de Sonia en las tarjetas (morado/verde/naranja) — sin
  // este safelist, en build de producción a veces se pierde el ring
  // y el shadow y el indicador no se ve.
  safelist: [
    "ring-2",
    "ring-violet-500",
    "shadow-violet-300",
    "ring-emerald-500",
    "shadow-emerald-300",
    "ring-amber-500",
    "shadow-amber-300",
    "shadow-lg",
    "animate-pulse",
    "bg-violet-600",
    "border-violet-700",
    "bg-emerald-600",
    "border-emerald-700",
    "bg-amber-500",
    "border-amber-600"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f7ff",
          100: "#eaeefe",
          200: "#cdd6fb",
          300: "#a4b3f7",
          400: "#7787f1",
          500: "#525fea",
          600: "#3f47d8",
          700: "#3439b3",
          800: "#2c3091",
          900: "#272a73"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
