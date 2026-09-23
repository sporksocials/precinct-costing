import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Impact", "sans-serif"],
        venue: ["var(--font-venue)", "var(--font-display)", "sans-serif"],
      },
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        elevated: v("elevated"),
        label: v("label"),
        "label-2": v("label-2"),
        "label-3": v("label-3"),
        sep: v("separator"),
        fill: v("fill"),
        "fill-2": v("fill-2"),
        accent: v("accent"),
        "accent-fill": v("accent-fill"),
        "accent-on": v("accent-on"),
        "accent-soft": v("accent-soft"),
        "venue-2": v("venue-2"),
        drift: "#b3e3f2",
        navy: "#0a3848",
        chiobu: "#c6102e",
        greedy: "#f26345",
        teal: "#92c5bd",
        gelato: "#ed8ccd",
        sand: "#d9c3a0",
        danger: v("danger"),
        "danger-soft": v("danger-soft"),
        warn: v("warn"),
        good: v("good"),
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.375rem",
      },
      fontSize: {
        "large-title": ["2.125rem", { lineHeight: "2.5rem", letterSpacing: "0.01em", fontWeight: "700" }],
        hero: ["3.5rem", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      spacing: {
        safe: "env(safe-area-inset-bottom)",
      },
      transitionTimingFunction: {
        ios: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
