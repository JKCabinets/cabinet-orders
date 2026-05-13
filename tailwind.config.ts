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
        // Body and UI — DM Sans per brand guide
        sans: ["var(--font-sans)", "DM Sans", "system-ui", "sans-serif"],
        // Display / editorial — Cormorant Garamond per brand guide
        serif: ["var(--font-serif)", "Cormorant Garamond", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        // ── Brand palette (JK Cabinets) ──
        sage: {
          DEFAULT: "#576257",
          mid:     "#91a597",
          deep:    "#3a4239",
          tint:    "#dde3dd",
        },
        storm: {
          DEFAULT: "#4a5a6b", // italic accents only, never as surface
          tint:    "#e6ebf0",
        },
        ink:      "#1a1a18",
        charcoal: "#2a2a26",
        body:     "#6b6b66",
        muted:    "#a0a09a",
        cream:    "#f0ece4",
        beige:    "#e0d8cc",
        terracotta: {
          DEFAULT: "#b8826a",
          light:   "#f0e2d8",
        },

        // ── Operational stage colors (unchanged) ──
        // Keep these because they encode stage state in cards and dashboards.
        stage: {
          new:       "#c97070", // softened from #e05555 for the lighter palette
          entered:   "#d4922a",
          prod:      "#c8b84a",
          cross:     "#5a8db8", // softened from #4a8fd4
          delivered: "#8fbe70", // softened from #4caf7a
        },

        // ── Legacy surface tokens (kept for components not yet restyled) ──
        surface: {
          DEFAULT:   "#1e2a35",
          secondary: "rgba(255,255,255,0.04)",
          card:      "rgba(255,255,255,0.06)",
          hover:     "rgba(255,255,255,0.08)",
          border:    "rgba(255,255,255,0.10)",
        },
        accent: {
          DEFAULT: "#f0ece4", // same as cream
          muted:   "rgba(240,236,228,0.55)",
          dim:     "rgba(240,236,228,0.30)",
          olive:   "#566448",
        },
      },
      borderRadius: {
        // Brand uses 12px for everything; pills are 999px (already in Tailwind as "full")
        brand: "12px",
        panel: "16px", // frosted panel radius
      },
      transitionTimingFunction: {
        // Brand "quiet motion" easing
        brand: "cubic-bezier(0.22, 0.9, 0.36, 1)",
      },
      animation: {
        "slide-in": "slideIn 0.2s cubic-bezier(0.22, 0.9, 0.36, 1)",
        "fade-in":  "fadeIn 0.15s ease-out",
        "card-in":  "cardIn 0.25s cubic-bezier(0.22, 0.9, 0.36, 1) both",
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
