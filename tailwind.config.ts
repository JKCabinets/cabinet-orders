import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      colors: {
        // Legacy — kept for components not yet converted
        surface: {
          DEFAULT:   "#1e2a35",
          secondary: "rgba(255,255,255,0.04)",
          card:      "rgba(255,255,255,0.06)",
          hover:     "rgba(255,255,255,0.08)",
          border:    "rgba(255,255,255,0.10)",
        },
        accent: {
          DEFAULT: "#e8e3da",
          muted:   "rgba(232,227,218,0.55)",
          dim:     "rgba(232,227,218,0.30)",
          olive:   "#566448",
        },
        stage: {
          new:       "#e05555",
          entered:   "#d4922a",
          prod:      "#c8b84a",
          cross:     "#4a8fd4",
          delivered: "#4caf7a",
        },
      },
      animation: {
        "slide-in": "slideIn 0.2s ease-out",
        "fade-in":  "fadeIn 0.15s ease-out",
        "card-in":  "cardIn 0.2s ease-out both",
      },
      keyframes: {
        slideIn: {
          "0%":   { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)",   opacity: "1" },
        },
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        cardIn: {
          "0%":   { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)",   opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
