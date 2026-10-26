import { useEffect, useState } from 'react'
import { DOCS_TREINAMENTO, type DocTreinamento } from '../lib/treinamento'

// ============================================================
// 📚 Treinamento — biblioteca de documentos para a equipe (26/10/2026).
// Lista à esquerda (src/lib/treinamento.ts) e o documento aberto num iframe à direita.
// Os documentos são páginas HTML estáticas em public/treinamento/ — sem banco, sem API.
// ============================================================

const BASE = 'treinamento/'   // relativo à página (vite base './' — funciona no GitHub Pages)
const fmtData = (d: string) => { const [a, m, dd] = d.split('-'); return `${dd}/${m}/${a}` }

export default function Treinamento({ isAdmin }: { isAdmin: boolean }) {
  const docs = DOCS_TREINAMENTO.filter(d => isAdmin || d.publico === 'todos')
    .sort((a, b) => b.data.localeCompare(a.data))
  const [sel, setSel] = useState<DocTreinamento | null>(null)
  const [listaAberta, setListaAberta] = useState(true)   // mobile: lista ou leitura
  useEffect(() => { if (!sel && docs.length) setSel(docs[0]) }, [docs.length])
  const abrir = (d: DocTreinamento) => { setSel(d); setListaAberta(false) }

  return (
    <div className="h-full flex min-h-0">
      {/* lista */}
      <div className={`${listaAberta ? 'flex' : 'hidden lg:flex'} w-full lg:w-80 shrink-0 border-r border-line flex-col min-h-0`}>
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-semibold">📚 Treinamento</div>
          <div className="text-[11px] text-dim mt-0.5">Guias e procedimentos da equipe. Leia o mais recente primeiro.</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {docs.map(d => (
            <button key={d.id} onClick={() => abrir(d)}
              className={`w-full text-left px-4 py-3 border-b border-line/50 hover:bg-panel2/50 transition-colors ${sel?.id === d.id ? 'bg-panel2' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{d.titulo}</span>
                <span className="ml-auto font-mono text-[10px] text-dim shrink-0">{fmtData(d.data)}</span>
              </div>
              <div className="text-[12px] text-dim mt-1 leading-snug">{d.descricao}</div>
              {d.tags?.length ? (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {d.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">{t}</span>)}
                  {d.publico === 'admin' && <span className="text-[10px] px-1.5 py-0.5 rounded border border-gold/40 text-gold">só admin</span>}
                </div>
              ) : null}
            </button>
          ))}
          {!docs.length && <div className="p-6 text-sm text-dim text-center">Nenhum documento publicado ainda.</div>}
        </div>
      </div>
      {/* leitor */}
      <div className={`${listaAberta ? 'hidden lg:flex' : 'flex'} flex-1 min-w-0 flex-col min-h-0`}>
        {sel ? (
          <>
            <div className="px-4 py-2 border-b border-line flex items-center gap-3 text-[12px]">
              <button onClick={() => setListaAberta(true)} className="lg:hidden text-dim hover:text-cream">‹ Documentos</button>
              <span className="font-medium truncate">{sel.titulo}</span>
              <span className="font-mono text-[10px] text-dim">{fmtData(sel.data)}</span>
              <a href={BASE + sel.arquivo} target="_blank" rel="noreferrer"
                className="ml-auto text-dim hover:text-gold border border-line rounded-lg px-2.5 py-1 transition" title="Abrir em outra aba (para imprimir ou mandar o link)">↗ abrir em nova aba</a>
            </div>
            <iframe key={sel.id} src={BASE + sel.arquivo} title={sel.titulo} className="flex-1 w-full border-0 bg-ink" />
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-dim text-sm">Escolha um documento.</div>
        )}
      </div>
    </div>
  )
}
