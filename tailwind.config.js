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
        amber: '#ef9a3c',   // semáforo: bola com você, sem resposta pendente (25/10)
        frio: '#5f7368',    // semáforo: lead frio
        jevA: '#b89cff',    // classe A do Jev
        jevB: '#6fb3e0',    // classe B do Jev
      },
    },
  },
  plugins: [],
}
