/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        chart: "#E9EDF0", // page
        ink: "#0F1B26", // text, rules
        signal: { DEFAULT: "#2341E8", soft: "#DDE3FC" }, // interactive
        scope: { DEFAULT: "#0C1620", line: "#22384A" }, // radar panel
        ping: "#FFB454", // the searched technology
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};