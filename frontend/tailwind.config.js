/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          navy: {
            DEFAULT: '#0a0f24',
            light: '#111936',
            dark: '#050710',
          },
          blue: {
            DEFAULT: '#1E90FF', // Electric blue
            hover: '#007FFF',
            glow: 'rgba(30, 144, 255, 0.15)'
          },
          zinc: {
            DEFAULT: '#09090b',
            card: '#0c0c0f',
            border: '#1e1e24',
            text: '#fafafa',
            muted: '#52525b'
          }
        }
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        heading: ['"Syne"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
