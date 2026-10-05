import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcd7ff",
          300: "#8fb9ff",
          400: "#5c92ff",
          500: "#2f6bff",
          600: "#2456d6",
          700: "#1c44ab",
          800: "#193a8a",
          900: "#18326d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
