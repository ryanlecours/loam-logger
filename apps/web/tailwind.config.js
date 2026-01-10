import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [
    plugin(function ({ addUtilities }) {
      const newUtilities = {
        /* Backgrounds */
        '.bg-app': { backgroundColor: 'rgb(var(--bg) / <alpha-value>)' },
        '.bg-surface': { backgroundColor: 'rgb(var(--surface) / <alpha-value>)' },
        '.bg-surface-2': { backgroundColor: 'rgb(var(--surface-2) / <alpha-value>)' },
        '.bg-accent': { backgroundColor: 'rgb(var(--surface-accent) / <alpha-value>)' },

        /* Text colors */
        '.text-app': { color: 'rgb(var(--text) / <alpha-value>)' },
        '.text-muted': { color: 'rgb(var(--text-muted) / <alpha-value>)' },
        '.text-accent': { color: 'rgb(var(--primary) / <alpha-value>)' },
        '.text-accent-contrast': { color: 'rgb(var(--primary-foreground) / <alpha-value>)' },

        /* Brand colors */
        '.text-sage': { color: 'var(--sage)' },
        '.text-mint': { color: 'var(--mint)' },
        '.text-moss': { color: 'var(--moss)' },
        '.text-gold': { color: 'var(--gold)' },
        '.text-copper': { color: 'var(--copper)' },

        /* Semantic status colors */
        '.text-success': { color: 'rgb(var(--success) / <alpha-value>)' },
        '.text-warning': { color: 'rgb(var(--warning) / <alpha-value>)' },
        '.text-danger': { color: 'rgb(var(--danger) / <alpha-value>)' },
        '.text-info': { color: 'rgb(var(--primary) / <alpha-value>)' },

        '.bg-success': { backgroundColor: 'rgb(var(--success) / <alpha-value>)' },
        '.bg-warning': { backgroundColor: 'rgb(var(--warning) / <alpha-value>)' },
        '.bg-danger': { backgroundColor: 'rgb(var(--danger) / <alpha-value>)' },
        '.bg-info': { backgroundColor: 'rgb(var(--primary) / <alpha-value>)' },

        '.border-success': { borderColor: 'rgb(var(--success) / <alpha-value>)' },
        '.border-warning': { borderColor: 'rgb(var(--warning) / <alpha-value>)' },
        '.border-danger': { borderColor: 'rgb(var(--danger) / <alpha-value>)' },
        '.border-info': { borderColor: 'rgb(var(--primary) / <alpha-value>)' },

        /* Foreground colors for status badges */
        '.text-success-foreground': { color: 'rgb(var(--success-foreground) / <alpha-value>)' },
        '.text-warning-foreground': { color: 'rgb(var(--warning-foreground) / <alpha-value>)' },
        '.text-danger-foreground': { color: 'rgb(var(--danger-foreground) / <alpha-value>)' },
        '.text-info-foreground': { color: 'rgb(var(--info-foreground) / <alpha-value>)' },

        /* Borders & Rings */
        '.border-app': { borderColor: 'rgb(var(--border) / <alpha-value>)' },
        '.ring-app': { '--tw-ring-color': 'rgb(var(--ring) / <alpha-value>)' },
      }

      addUtilities(newUtilities, ['responsive', 'dark', 'hover'])
    }),
  ],
}
