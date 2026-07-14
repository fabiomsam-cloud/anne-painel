import { useEffect, useState } from 'react'
import { supabase, fmtHora } from '../lib/supabase'

type Profile = {
  id: string; slug: string; name: string; active: boolean; model: string
  system_prompt: string | null; dados_mentoria: any; checkout_url: string | null
}
type Doc = {
  id: string; agent_slug: string; title: string; doc_type: string; status: string
  version: number; updated_at: string; error: string | null
}

export default function Config() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [novoDoc, setNovoDoc] = useState({ agent_slug: 'elite_prf', title: '', doc_type: 'faq', raw_content: '' })
  const [msgOk, setMsgOk] = useState('')

  const carregar = async () => {
    const { data: p } = await supabase.from('agent_profiles').select('*').order('slug')
    setProfiles((p as any) ?? [])
    const { data: d } = await supabase.from('knowledge_documents')
      .select('id,agent_slug,title,doc_type,status,version,updated_at,error')
      .order('updated_at', { ascending: false }).limit(50)
    setDocs((d as any) ?? [])
  }

  useEffect(() => {
    carregar()
    const ch = supabase.channel('config-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'knowledge_documents' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const enviarDoc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!novoDoc.title.trim() || !novoDoc.raw_content.trim()) return
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('knowledge_documents').insert({
      ...novoDoc, source: 'painel', created_by: u.user?.email ?? 'painel',
    })
    setNovoDoc({ ...novoDoc, title: '', raw_content: '' })
    flash('Documento enviado — a ingestão roda automaticamente (status vira "ready").')
  }

  const flash = (t: string) => { setMsgOk(t); setTimeout(() => setMsgOk(''), 6000) }

  const STATUS_DOC: Record<string, string> = {
    pending: 'text-dim', processing: 'text-gold', ready: 'text-win', error: 'text-danger',
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 max-w-4xl">
      {msgOk && (
        <div className="rise border border-win/40 bg-win/10 text-win text-sm rounded-xl px-4 py-3">{msgOk}</div>
      )}

      {/* Agentes migraram para a aba própria */}
      <section>
        <h1 className="font-display font-bold text-2xl mb-2">Configuração</h1>
        <p className="text-xs text-dim">
          A edição dos agentes (prompts por seção, preços, palavras-chave, histórico de versões)
          fica na aba <b className="text-gold">🤖 Agentes</b>.
        </p>
      </section>

      {/* Base de conhecimento */}
      <section>
        <h2 className="font-display font-bold text-xl mb-1">Base de conhecimento</h2>
        <p className="text-xs text-dim mb-4">
          Cole o conteúdo (edital, FAQ, detalhes da mentoria) e envie — os embeddings são gerados
          automaticamente e a IA passa a usar em segundos.
        </p>

        <form onSubmit={enviarDoc} className="border border-line bg-panel/50 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-dim">Mentoria
              <select value={novoDoc.agent_slug} onChange={e => setNovoDoc({ ...novoDoc, agent_slug: e.target.value })}
                className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none">
                {profiles.filter(p => p.slug !== 'roteador').map(p => (
                  <option key={p.slug} value={p.slug}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-dim">Tipo
              <select value={novoDoc.doc_type} onChange={e => setNovoDoc({ ...novoDoc, doc_type: e.target.value })}
                className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none">
                <option value="faq">FAQ</option>
                <option value="edital">Edital / concurso</option>
                <option value="mentoria">Mentoria</option>
                <option value="outro">Outro</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-dim">Título
            <input value={novoDoc.title} onChange={e => setNovoDoc({ ...novoDoc, title: e.target.value })}
              placeholder="ex.: FAQ atualizado pós-retificação do edital"
              className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60 placeholder:text-dim/40" />
          </label>
          <label className="block text-xs text-dim">Conteúdo
            <textarea rows={7} value={novoDoc.raw_content}
              onChange={e => setNovoDoc({ ...novoDoc, raw_content: e.target.value })}
              placeholder="Cole aqui o texto completo…"
              className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-xs text-cream leading-relaxed focus:outline-none focus:border-gold/60 placeholder:text-dim/40" />
          </label>
          <button className="bg-teal/15 text-teal border border-teal/40 font-semibold rounded-lg px-5 py-2 text-sm hover:bg-teal/25 transition">
            Enviar para a base →
          </button>
        </form>

        <div className="mt-4 space-y-1.5">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 text-sm border border-line/60 bg-panel/30 rounded-lg px-3.5 py-2.5">
              <span className={`font-mono text-[10px] uppercase ${STATUS_DOC[d.status] ?? 'text-dim'}`}>● {d.status}</span>
              <span className="truncate">{d.title}</span>
              <span className="font-mono text-[10px] text-dim">{d.agent_slug} · {d.doc_type} · v{d.version}</span>
              <span className="ml-auto font-mono text-[10px] text-dim/60 shrink-0">{fmtHora(d.updated_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
