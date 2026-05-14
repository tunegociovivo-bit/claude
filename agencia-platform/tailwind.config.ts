import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
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
