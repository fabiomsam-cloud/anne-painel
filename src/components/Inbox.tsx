import { useEffect, useRef, useState } from 'react'
import { supabase, AGENT_LABEL, STATUS_META, fmtHora, fmtFone } from '../lib/supabase'

type Conv = {
  id: string; status: string; current_agent_slug: string; last_message_at: string | null
  contexto: any
  contacts: { id: string; name: string | null; phone: string; tags: string[]; client_memory: any; opted_out: boolean }
}
type Msg = {
  id: string; from_type: string; type: string; content: string | null; transcript: string | null
  status: string; created_at: string; metadata: any; agent_slug: string | null
}

const FROM_STYLE: Record<string, string> = {
  user: 'self-start bg-panel2 border-line',
  ia: 'self-end bg-teal/10 border-teal/25',
  human: 'self-end bg-gold/10 border-gold/30',
  system: 'self-center bg-panel border-line text-dim text-xs',
}

export default function Inbox() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [sel, setSel] = useState<Conv | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [filtroAgente, setFiltroAgente] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [busca, setBusca] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [followup, setFollowup] = useState<any>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  const carregarConvs = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('id,status,current_agent_slug,last_message_at,contexto,contacts(id,name,phone,tags,client_memory,opted_out)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200)
    setConvs((data as any) ?? [])
  }

  useEffect(() => {
    carregarConvs()
    const ch = supabase.channel('inbox-convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, carregarConvs)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const carregarMsgs = async (convId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('id,from_type,type,content,transcript,status,created_at,metadata,agent_slug')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(300)
    setMsgs((data as any) ?? [])
    const { data: fq } = await supabase
      .from('followup_queue').select('current_step,due_at,status')
      .eq('conversation_id', convId).eq('status', 'scheduled').maybeSingle()
    setFollowup(fq)
  }

  useEffect(() => {
    if (!sel) return
    carregarMsgs(sel.id)
    const ch = supabase.channel(`thread-${sel.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${sel.id}` },
        payload => setMsgs(m => [...m, payload.new as Msg]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [sel?.id])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  const assumir = async () => {
    if (!sel) return
    await supabase.from('conversations').update({ status: 'human' }).eq('id', sel.id)
    setSel({ ...sel, status: 'human' })
  }

  const devolverIA = async () => {
    if (!sel) return
    await supabase.from('conversations').update({ status: 'ia' }).eq('id', sel.id)
    await supabase.from('escalations').update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('conversation_id', sel.id).eq('status', 'open')
    setSel({ ...sel, status: 'ia' })
  }

  const apagarConversa = async () => {
    if (!sel) return
    const nome = sel.contacts?.name || fmtFone(sel.contacts?.phone)
    if (!window.confirm(
      `Apagar TODA a conversa com ${nome}?\n\n` +
      'Isso remove mensagens, follow-ups e escalações, e zera a memória que a IA construiu do lead. ' +
      'A próxima mensagem dele começa do zero, na triagem. Não dá para desfazer.')) return
    // conversa (cascade: messages, followup_queue/log, escalations) + reset da memória do contato
    await supabase.from('conversations').delete().eq('id', sel.id)
    await supabase.from('contacts').update({ client_memory: {}, tags: [], opted_out: false, opted_out_at: null })
      .eq('id', sel.contacts.id)
    setSel(null); setMsgs([]); carregarConvs()
  }

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sel || !texto.trim() || enviando) return
    setEnviando(true)
    const t = texto.trim()
    const { data: msg } = await supabase.from('messages').insert({
      conversation_id: sel.id, from_type: 'human', type: 'text', content: t, status: 'queued',
    }).select('id').single()
    await supabase.from('send_queue').insert({
      conversation_id: sel.id, message_id: msg?.id ?? null,
      phone: sel.contacts.phone, parts: [t], priority: 1,
    })
    setTexto(''); setEnviando(false)
  }

  const lista = convs.filter(c => {
    if (filtroAgente && c.current_agent_slug !== filtroAgente) return false
    if (filtroStatus && c.status !== filtroStatus) return false
    if (busca) {
      const q = busca.toLowerCase()
      if (!(c.contacts?.name ?? '').toLowerCase().includes(q) && !(c.contacts?.phone ?? '').includes(q)) return false
    }
    return true
  })

  const mem = sel?.contacts?.client_memory ?? {}

  return (
    <div className="h-full flex">
      {/* Lista de conversas */}
      <div className="w-80 shrink-0 border-r border-line flex flex-col">
        <div className="p-3 border-b border-line space-y-2">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou telefone…"
            className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60 placeholder:text-dim/50" />
          <div className="flex gap-2">
            <select value={filtroAgente} onChange={e => setFiltroAgente(e.target.value)}
              className="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-dim focus:outline-none">
              <option value="">Todas mentorias</option>
              {Object.entries(AGENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
              className="flex-1 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-dim focus:outline-none">
              <option value="">Todos status</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.map(c => (
            <button key={c.id} onClick={() => setSel(c)}
              className={`w-full text-left px-4 py-3 border-b border-line/50 hover:bg-panel2/50 transition-colors
                ${sel?.id === c.id ? 'bg-panel2' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{c.contacts?.name || fmtFone(c.contacts?.phone)}</span>
                <span className="font-mono text-[10px] text-dim shrink-0">{fmtHora(c.last_message_at)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[c.status]?.cls ?? ''}`}>
                  {STATUS_META[c.status]?.label ?? c.status}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">
                  {AGENT_LABEL[c.current_agent_slug] ?? c.current_agent_slug}
                </span>
              </div>
            </button>
          ))}
          {lista.length === 0 && <div className="p-6 text-center text-dim text-sm">Nenhuma conversa.</div>}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!sel ? (
          <div className="flex-1 grid place-items-center text-dim">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm">Selecione uma conversa</div>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-line flex items-center gap-3">
              <div className="min-w-0">
                <div className="font-display font-semibold truncate">{sel.contacts?.name || 'Sem nome'}</div>
                <div className="font-mono text-[11px] text-dim">{fmtFone(sel.contacts?.phone)}</div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {sel.status === 'human' ? (
                  <button onClick={devolverIA}
                    className="text-xs font-semibold bg-teal/15 text-teal border border-teal/40 rounded-lg px-3 py-1.5 hover:bg-teal/25 transition">
                    ↩ Devolver para a IA
                  </button>
                ) : (
                  <button onClick={assumir}
                    className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">
                    ✋ Assumir conversa
                  </button>
                )}
                <button onClick={apagarConversa} title="Apagar conversa e zerar memória do lead"
                  className="text-xs text-danger/80 border border-danger/30 rounded-lg px-2.5 py-1.5 hover:bg-danger/10 hover:text-danger transition">
                  🗑
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2">
              {msgs.map(m => (
                <div key={m.id} className={`rise max-w-[78%] border rounded-2xl px-3.5 py-2 ${FROM_STYLE[m.from_type] ?? FROM_STYLE.system}`}>
                  {m.metadata?.followup_step && (
                    <div className="text-[10px] font-mono text-gold/80 mb-1">⏰ follow-up · toque {m.metadata.followup_step}</div>
                  )}
                  {m.type === 'audio' && <div className="text-[10px] font-mono text-dim mb-1">🎙 áudio transcrito</div>}
                  <div className="text-sm whitespace-pre-wrap break-words">{m.transcript || m.content}</div>
                  <div className="text-[10px] font-mono text-dim/70 mt-1 text-right">
                    {m.from_type === 'ia' ? '🤖 ' : m.from_type === 'human' ? '👤 ' : ''}{fmtHora(m.created_at)}
                  </div>
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            <form onSubmit={enviar} className="p-4 border-t border-line flex gap-2">
              <input value={texto} onChange={e => setTexto(e.target.value)}
                placeholder={sel.status === 'human' ? 'Responder como humano…' : 'Assuma a conversa para responder (IA está atendendo)'}
                disabled={sel.status !== 'human'}
                className="flex-1 bg-panel border border-line rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gold/60 disabled:opacity-40 placeholder:text-dim/50" />
              <button disabled={sel.status !== 'human' || !texto.trim() || enviando}
                className="bg-gold text-ink font-semibold rounded-xl px-5 text-sm disabled:opacity-30 hover:brightness-110 transition">
                Enviar
              </button>
            </form>
          </>
        )}
      </div>

      {/* Painel do lead */}
      {sel && (
        <div className="w-72 shrink-0 border-l border-line overflow-y-auto p-4 space-y-4">
          <div>
            <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Lead</div>
            <div className="font-display font-semibold text-lg">{sel.contacts?.name || '—'}</div>
            <div className="font-mono text-xs text-dim mt-0.5">{fmtFone(sel.contacts?.phone)}</div>
          </div>
          {followup && (
            <div className="border border-gold/25 bg-gold/5 rounded-xl p-3">
              <div className="text-[10px] font-mono text-gold uppercase tracking-widest">Follow-up armado</div>
              <div className="text-sm mt-1">Toque <b>{followup.current_step}</b> · {fmtHora(followup.due_at)}</div>
            </div>
          )}
          {(sel.contacts?.tags?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-2">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {sel.contacts.tags.map(t => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-teal/30 text-teal bg-teal/5">{t}</span>
                ))}
              </div>
            </div>
          )}
          {mem.fase_venda && (
            <div className="border border-teal/25 bg-teal/5 rounded-xl p-3">
              <div className="text-[10px] font-mono text-teal uppercase tracking-widest">Fase de venda</div>
              <div className="text-sm mt-1 font-medium">
                {['1 · Situação', '2 · Problema', '3 · Valor', '4 · Oferta'][mem.fase_venda - 1] ?? mem.fase_venda}
              </div>
            </div>
          )}
          {mem.lead_stage && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Estágio</div>
              <div className="text-sm text-gold font-medium">{mem.lead_stage}</div>
            </div>
          )}
          {(mem.interesses?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Interesses</div>
              <div className="text-sm text-dim">{mem.interesses.join(', ')}</div>
            </div>
          )}
          {(mem.objections?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Objeções</div>
              <div className="text-sm text-dim">{mem.objections.join(', ')}</div>
            </div>
          )}
          {mem.notas && (
            <div>
              <div className="text-[10px] font-mono text-dim uppercase tracking-widest mb-1">Notas da IA</div>
              <div className="text-sm text-dim leading-relaxed">{mem.notas}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
