import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', '"SF Pro Display"', "Inter", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "system-ui", "sans-serif"],
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
