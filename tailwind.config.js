/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sensia: {
          dark: "#021712",
          surface: "#042920",
          surfaceLight: "#073d30",
          border: "rgba(16, 185, 129, 0.25)",
          emerald: "#059669",
          emeraldLight: "#10b981",
          emeraldGlow: "rgba(16, 185, 129, 0.3)",
          gold: "#d97706",
          goldLight: "#f59e0b",
          goldBright: "#fbbf24",
          goldGlow: "rgba(217, 119, 6, 0.35)",
          goldBorder: "rgba(245, 158, 11, 0.3)",
          cream: "#fefcf5",
          textMuted: "#a7f3d0",
        },
        brand: {
          dark: "#021712",
          surface: "#042920",
          surfaceLight: "#073d30",
          border: "rgba(16, 185, 129, 0.25)",
          accent: "#10b981",
          accentGlow: "rgba(16, 185, 129, 0.25)",
          gold: "#f59e0b",
          goldGlow: "rgba(245, 158, 11, 0.25)",
          textMuted: "#a7f3d0",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      animation: {
        'pulse-subtle': 'pulseSubtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
