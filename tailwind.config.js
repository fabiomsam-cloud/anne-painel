/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'sans-serif'],
        body: ['"Instrument Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: '#0b1512',
        panel: '#101d19',
        panel2: '#16261f',
        line: '#1f332a',
        gold: '#f5b942',
        teal: '#35d0ba',
        cream: '#e8efe9',
        dim: '#8aa396',
        danger: '#e06f6f',
        win: '#6fe08c',
      },
    },
  },
  plugins: [],
}
