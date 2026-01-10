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
  theme: {
  extend: {
    colors: {
      gunmetal: {
        DEFAULT: '#272d2d',
        100: '#080909',
        200: '#0f1111',
        300: '#171a1a',
        400: '#1e2323',
        500: '#272d2d',
        600: '#4e5959',
        700: '#768787',
        800: '#a3afaf',
        900: '#d1d7d7'
      },
      raw_umber: {
        DEFAULT: '#8e5f3e',
        100: '#1c130c',
        200: '#392619',
        300: '#553925',
        400: '#714c32',
        500: '#8e5f3e',
        600: '#b47d55',
        700: '#c79d7f',
        800: '#dabeaa',
        900: '#ecded4'
      },
      cal_poly_green: {
        DEFAULT: '#26402a',
        100: '#080d08',
        200: '#0f1a11',
        300: '#172619',
        400: '#1f3322',
        500: '#26402a',
        600: '#45734c',
        700: '#66a36f',
        800: '#99c29f',
        900: '#cce0cf'
      },
      seasalt: {
        DEFAULT: '#fbfaf8',
        100: '#3f3624',
        200: '#7f6d49',
        300: '#b29f7a',
        400: '#d7cdb9',
        500: '#fbfaf8',
        600: '#fcfbfa',
        700: '#fdfcfb',
        800: '#fefdfc',
        900: '#fefefe'
      },
      cosmic_latte: {
        DEFAULT: '#f7f3e3',
        100: '#4a3f15',
        200: '#947f2a',
        300: '#cdb44f',
        400: '#e2d499',
        500: '#f7f3e3',
        600: '#f9f6e9',
        700: '#faf8ee',
        800: '#fcfaf4',
        900: '#fdfdf9'
      }
    }
  }
}

}
