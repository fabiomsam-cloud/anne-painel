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
  const [editando, setEditando] = useState<Profile | null>(null)
  const [salvando, setSalvando] = useState(false)
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

  const salvarProfile = async () => {
    if (!editando) return
    setSalvando(true)
    await supabase.from('agent_profiles').update({
      name: editando.name, active: editando.active, model: editando.model,
      system_prompt: editando.system_prompt, checkout_url: editando.checkout_url,
      dados_mentoria: editando.dados_mentoria,
    }).eq('id', editando.id)
    setSalvando(false); setEditando(null); carregar()
    flash('Perfil salvo — vale já na próxima mensagem.')
  }

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

      {/* Agentes */}
      <section>
        <h1 className="font-display font-bold text-2xl mb-4">Agentes</h1>
        <div className="space-y-2">
          {profiles.map(p => (
            <div key={p.id} className="border border-line bg-panel/50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${p.active ? 'bg-win' : 'bg-dim'}`} />
                <span className="font-semibold">{p.name}</span>
                <span className="font-mono text-[10px] text-dim">{p.slug} · {p.model}</span>
                {p.dados_mentoria?.valor_promocional && (
                  <span className="text-[11px] text-gold font-mono">{p.dados_mentoria.valor_promocional}</span>
                )}
                <button onClick={() => setEditando(editando?.id === p.id ? null : { ...p })}
                  className="ml-auto text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">
                  {editando?.id === p.id ? 'Fechar' : 'Editar'}
                </button>
              </div>

              {editando?.id === p.id && (
                <div className="mt-4 space-y-3 rise">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-dim">Nome
                      <input value={editando.name} onChange={e => setEditando({ ...editando, name: e.target.value })}
                        className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-gold/60" />
                    </label>
                    <label className="block text-xs text-dim">Modelo
                      <input value={editando.model} onChange={e => setEditando({ ...editando, model: e.target.value })}
                        className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm font-mono text-cream focus:outline-none focus:border-gold/60" />
                    </label>
                  </div>
                  <label className="block text-xs text-dim">Link de checkout (Hubla)
                    <input value={editando.checkout_url ?? ''} onChange={e => setEditando({ ...editando, checkout_url: e.target.value })}
                      className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm font-mono text-cream focus:outline-none focus:border-gold/60" />
                  </label>
                  <label className="block text-xs text-dim">Dados da mentoria (JSON — preço/condições; fonte única da IA)
                    <textarea rows={4} value={JSON.stringify(editando.dados_mentoria ?? {}, null, 2)}
                      onChange={e => { try { setEditando({ ...editando, dados_mentoria: JSON.parse(e.target.value) }) } catch {} }}
                      className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-xs font-mono text-cream focus:outline-none focus:border-gold/60" />
                  </label>
                  <label className="block text-xs text-dim">System prompt
                    <textarea rows={10} value={editando.system_prompt ?? ''}
                      onChange={e => setEditando({ ...editando, system_prompt: e.target.value })}
                      className="mt-1 w-full bg-panel border border-line rounded-lg px-3 py-2 text-xs text-cream leading-relaxed focus:outline-none focus:border-gold/60" />
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-dim flex items-center gap-2">
                      <input type="checkbox" checked={editando.active}
                        onChange={e => setEditando({ ...editando, active: e.target.checked })} className="accent-[#f5b942]" />
                      agente ativo
                    </label>
                    <button onClick={salvarProfile} disabled={salvando}
                      className="ml-auto bg-gold text-ink font-semibold rounded-lg px-5 py-2 text-sm hover:brightness-110 transition disabled:opacity-50">
                      {salvando ? 'Salvando…' : 'Salvar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
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
