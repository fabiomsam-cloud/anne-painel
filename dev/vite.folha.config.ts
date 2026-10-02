// Build ESTÁTICO do harness da folha (para o PDF das 07h). Rodar a partir de anne/painel:
//   npx vite build --config dev/vite.folha.config.ts      → gera ../folha/site/
// Refazer sempre que Historico.tsx, folha.ts ou o CSS da folha mudarem.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  css: { postcss: resolve(__dirname, '..') },
  build: { outDir: resolve(__dirname, '../../folha/site'), emptyOutDir: true, rollupOptions: { input: resolve(__dirname, 'historico.html') } },
})
