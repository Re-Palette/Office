import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#08090A",
        surface: {
          DEFAULT: "#0D0E10",
          raised: "#111214",
          overlay: "#16181B",
          hover: "#1B1D21",
        },
        hairline: {
          DEFAULT: "rgba(255,255,255,0.07)",
          strong: "rgba(255,255,255,0.12)",
        },
        ink: {
          DEFAULT: "#F2F3F5",
          muted: "#9BA1AA",
          faint: "#6B7079",
          ghost: "#4A4E56",
        },
        accent: {
          DEFAULT: "#6C7CFF",
          soft: "#8D99FF",
          dim: "rgba(108,124,255,0.14)",
          line: "rgba(108,124,255,0.30)",
        },
        live: {
          DEFAULT: "#31D0A0",
          dim: "rgba(49,208,160,0.13)",
        },
        warn: { DEFAULT: "#E5A84B", dim: "rgba(229,168,75,0.13)" },
        danger: { DEFAULT: "#F0616D", dim: "rgba(240,97,109,0.13)" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        label: "0.14em",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 32px -12px rgba(0,0,0,0.9)",
        lift: "0 20px 50px -20px rgba(0,0,0,0.95)",
        glow: "0 0 0 1px rgba(108,124,255,0.25), 0 10px 40px -12px rgba(108,124,255,0.35)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(49,208,160,0.45)" },
          "70%": { boxShadow: "0 0 0 6px rgba(49,208,160,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(49,208,160,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "flow-dash": {
          to: { strokeDashoffset: "-16" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
        shimmer: "shimmer 2s infinite",
        "flow-dash": "flow-dash 1s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
