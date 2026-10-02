// Harness da folha: renderiza a aba Histórico com dados de ./fixture.json (sem login).
// Usos: (1) desenvolvimento: `npm run dev` → /dev/historico.html · (2) PDF das 07h: anne/folha/rotina_folha_anne.py
// gera o fixture com dados do banco e imprime esta página no Chrome headless. NÃO entra no build do painel.
// ?print=semana → só a semana corrente (2 páginas) · sem parâmetro → todas as semanas.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import Historico, { type FolhaAnne } from '../src/components/Historico'

function Harness() {
  const [dados, setDados] = useState<FolhaAnne | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    fetch('./fixture.json', { cache: 'no-store' }).then(r => r.json()).then(setDados).catch(e => setErro(String(e)))
  }, [])
  useEffect(() => {
    if (!dados) return
    if (new URLSearchParams(location.search).get('print') === 'semana') {
      document.body.classList.add('print-uma')
      document.querySelector('.folha')?.classList.add('alvo')     // a 1ª folha é a semana corrente
    }
    document.body.dataset.pronto = '1'
  }, [dados])
  if (erro) return <pre style={{ color: 'red' }}>fixture.json: {erro}</pre>
  return dados ? <Historico dadosIniciais={dados} /> : null
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
