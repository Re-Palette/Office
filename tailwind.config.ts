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
          DEFAULT: "rgba(255,255,255,0.09)",
          strong: "rgba(255,255,255,0.16)",
        },
        /**
         * Text ramp. Every step is measured against the surface (#0D0E10):
         * ink 17.7:1 · muted 8.7:1 · faint 5.8:1 · ghost 4.9:1.
         * The previous faint (3.9:1) and ghost (2.3:1) failed for body text,
         * which is what made labels, timestamps and hints hard to read.
         */
        ink: {
          DEFAULT: "#F4F5F7",
          muted: "#A8AEB8",
          faint: "#868D98",
          ghost: "#7A818D",
        },
        accent: {
          DEFAULT: "#6C7CFF",
          soft: "#9AA4FF",
          /** Darker step for filled buttons — white text needs 4.6:1 on it. */
          solid: "#5A67E8",
          dim: "rgba(108,124,255,0.16)",
          line: "rgba(108,124,255,0.38)",
        },
        /**
         * Status is reserved and always ships with a label — never colour alone.
         * Kept clear of the categorical hues below.
         */
        live: {
          DEFAULT: "#34D399",
          dim: "rgba(52,211,153,0.16)",
        },
        warn: { DEFAULT: "#F5B041", dim: "rgba(245,176,65,0.16)" },
        danger: { DEFAULT: "#FB7185", dim: "rgba(251,113,133,0.16)" },
        info: { DEFAULT: "#60A5FA", dim: "rgba(96,165,250,0.16)" },
        /**
         * Categorical identity (departments, chart series).
         *
         * Eight hues in a fixed order — the order is the colour-blind-safety
         * mechanism, not decoration. Validated against this surface:
         * worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3,
         * all eight ≥ 3:1. Never cycle it, never re-order it.
         */
        cat: {
          1: "#3987e5", // blue
          2: "#d95926", // orange
          3: "#199e70", // aqua
          4: "#c98500", // yellow
          5: "#d55181", // magenta
          6: "#008300", // green
          7: "#9085e9", // violet
          8: "#e66767", // red
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // 11px floor for anything the CEO is expected to read.
        "2xs": ["0.6875rem", { lineHeight: "1.05rem" }],
        "3xs": ["0.625rem", { lineHeight: "0.95rem" }],
      },
      letterSpacing: {
        label: "0.12em",
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
