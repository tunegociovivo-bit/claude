import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#2f6bff",
          600: "#2456d6",
          700: "#1c44ab",
        },
      },
    },
  },
  plugins: [],
};

export default config;
