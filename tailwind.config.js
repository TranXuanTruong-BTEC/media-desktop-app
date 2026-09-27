/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg:      "#0f1117",
        surface: "#181c27",
        border:  "#252a38",
        accent:  "#3b82f6",
        success: "#22c55e",
        warn:    "#f59e0b",
        danger:  "#ef4444",
        muted:   "#4b5563",
        text:    "#e2e8f0",
        subtle:  "#94a3b8",
      },
    },
  },
  plugins: [],
};
