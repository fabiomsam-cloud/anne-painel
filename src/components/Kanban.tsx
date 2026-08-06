import { useEffect, useState } from 'react'
import { supabase, AGENT_LABEL, STATUS_META, PIPELINE_COLS, pipelineCol, fmtHora, fmtFone } from '../lib/supabase'

type Conv = {
  id: string; status: string; current_agent_slug: string; last_message_at: string | null; created_at: string
  contacts: { id: string; name: string | null; phone: string; tags: string[]; client_memory: any }
}

const COLS = PIPELINE_COLS
const coluna = pipelineCol

const FASES = ['1 · Situação', '2 · Problema', '3 · Valor', '4 · Oferta']

export default function Kanban() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [sel, setSel] = useState<Conv | null>(null)
  const [notas, setNotas] = useState('')
  const [matricula, setMatricula] = useState('')
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 6000) }

  const carregar = async () => {
    const SEL = 'id,status,current_agent_slug,last_message_at,created_at,contacts(id,name,phone,tags,client_memory)'
    // 400 recentes + TODAS as human/won: matriculados e escalados nunca podem
    // sumir do pipeline por causa de um dia de disparo em massa
    const [rec, fixas] = await Promise.all([
      supabase.from('conversations').select(SEL)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(400),
      supabase.from('conversations').select(SEL).in('status', ['human', 'won', 'dormant', 'opted_out'])
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(400),
    ])
    const vistos = new Set<string>()
    const juntos = [...((rec.data as any) ?? []), ...((fixas.data as any) ?? [])]
      .filter((c: any) => { if (vistos.has(c.id)) return false; vistos.add(c.id); return true })
      .sort((a: any, b: any) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')))
    setConvs(juntos as any)
  }
  useEffect(() => {
    carregar()
    const ch = supabase.channel('kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const abrir = (c: Conv) => {
    setSel(c)
    setNotas(c.contacts?.client_memory?.notas_humano ?? '')
    setMatricula(c.contacts?.client_memory?.matricula_manual?.detalhes ?? '')
  }

  // mover: matriculado/humano/dormente mudam o STATUS real da conversa;
  // novo/negociando/checkout marcam kanban_override na memória do contato
  const mover = async (c: Conv, col: string) => {
    if (coluna(c) === col) return
    const mem = { ...(c.contacts?.client_memory ?? {}) }
    const statusPorCol: Record<string, string> = { matriculado: 'won', humano: 'human', dormente: 'dormant' }
    if (statusPorCol[col]) {
      delete mem.kanban_override
      await supabase.from('conversations').update({ status: statusPorCol[col] }).eq('id', c.id)
    } else {
      mem.kanban_override = col
      // sair de won/dormant pelo arrasto reativa o atendimento IA
      if (['won', 'dormant', 'opted_out'].includes(c.status))
        await supabase.from('conversations').update({ status: 'ia' }).eq('id', c.id)
    }
    await supabase.from('contacts').update({ client_memory: mem }).eq('id', c.contacts.id)
    flash(`${c.contacts?.name || fmtFone(c.contacts?.phone)} → ${COLS.find(x => x.id === col)?.label}`)
    carregar()
  }

  const salvarNotas = async () => {
    if (!sel) return
    setSalvando(true)
    const mem = { ...(sel.contacts?.client_memory ?? {}), notas_humano: notas.trim() || undefined }
    if (!notas.trim()) delete mem.notas_humano
    const { error } = await supabase.from('contacts').update({ client_memory: mem }).eq('id', sel.contacts.id)
    setSalvando(false)
    flash(error ? 'Erro: ' + error.message : '✅ Notas salvas.')
    if (!error) carregar()
  }

  const salvarMatricula = async () => {
    if (!sel || !matricula.trim()) return
    setSalvando(true)
    const { data: u } = await supabase.auth.getUser()
    const mem = {
      ...(sel.contacts?.client_memory ?? {}),
      matricula_manual: { detalhes: matricula.trim(), por: u.user?.email ?? 'painel', em: new Date().toISOString() },
    }
    delete mem.kanban_override
    await supabase.from('contacts').update({ client_memory: mem }).eq('id', sel.contacts.id)
    const { error } = await supabase.from('conversations').update({ status: 'won' }).eq('id', sel.id)
    setSalvando(false)
    flash(error ? 'Erro: ' + error.message : '🏆 Matrícula registrada — lead movido para Matriculados.')
    if (!error) { setSel(null); carregar() }
  }

  const mem = sel?.contacts?.client_memory ?? {}

  return (
    <div className="h-full overflow-x-auto p-4 md:p-6">
      <div className="flex items-center gap-4 mb-5">
        <h1 className="font-display font-bold text-2xl">Pipeline</h1>
        {msg && <div className="rise text-xs text-win border border-win/40 bg-win/10 rounded-lg px-3 py-1.5">{msg}</div>}
        <span className="ml-auto text-[11px] text-dim/70 hidden md:block">arraste os cards entre colunas · clique para detalhes</span>
      </div>
      <div className="flex gap-4 min-h-[70vh]">
        {COLS.map(col => {
          const items = convs.filter(c => coluna(c) === col.id)
          return (
            <div key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver(d => (d === col.id ? null : d))}
              onDrop={e => {
                e.preventDefault(); setDragOver(null)
                const cid = e.dataTransfer.getData('text/conv')
                const c = convs.find(x => x.id === cid)
                if (c) mover(c, col.id)
              }}
              className={`w-64 shrink-0 bg-panel/50 border ${dragOver === col.id ? 'border-gold/60' : 'border-line'} ${col.cor} border-t-2 rounded-xl flex flex-col transition-colors`}>
              <div className="px-3.5 py-3 border-b border-line">
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-semibold text-sm">{col.label}</span>
                  <span className="font-mono text-xs text-dim">{items.length}</span>
                </div>
                <div className="text-[10px] text-dim/70 mt-0.5">{col.hint}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.map(c => {
                  const m = c.contacts?.client_memory ?? {}
                  return (
                    <div key={c.id} draggable
                      onDragStart={e => e.dataTransfer.setData('text/conv', c.id)}
                      onClick={() => abrir(c)}
                      className="rise bg-panel2 border border-line rounded-lg p-3 cursor-pointer hover:border-gold/40 transition-colors">
                      <div className="font-medium text-sm truncate">{c.contacts?.name || fmtFone(c.contacts?.phone)}</div>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">
                          {AGENT_LABEL[c.current_agent_slug] ?? c.current_agent_slug}
                        </span>
                        {m.fase_venda && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-teal/30 text-teal">fase {m.fase_venda}</span>
                        )}
                        {m.notas_humano && <span className="text-[10px]" title="tem notas do humano">📝</span>}
                        <span className="ml-auto font-mono text-[10px] text-dim/70">{fmtHora(c.last_message_at)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal de detalhes do lead */}
      {sel && (
        <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm grid place-items-center p-4" onClick={() => setSel(null)}>
          <div className="rise w-full max-w-lg max-h-[90vh] overflow-y-auto bg-panel border border-line rounded-2xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <div className="font-display font-semibold text-xl truncate">{sel.contacts?.name || 'Sem nome'}</div>
                <div className="font-mono text-xs text-dim mt-0.5">{fmtFone(sel.contacts?.phone)}</div>
              </div>
              <button onClick={() => setSel(null)} className="ml-auto text-dim hover:text-cream text-xl leading-none">✕</button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_META[sel.status]?.cls ?? ''}`}>
                {STATUS_META[sel.status]?.label ?? sel.status}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-line text-dim">
                {AGENT_LABEL[sel.current_agent_slug] ?? sel.current_agent_slug}
              </span>
              {(sel.contacts?.tags ?? []).map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full border border-teal/30 text-teal bg-teal/5">{t}</span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {mem.fase_venda && (
                <div className="border border-teal/25 bg-teal/5 rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-teal uppercase">Fase de venda</div>
                  <div className="mt-0.5">{FASES[mem.fase_venda - 1] ?? mem.fase_venda}</div>
                </div>
              )}
              {mem.lead_stage && (
                <div className="border border-line rounded-lg p-2.5">
                  <div className="text-[10px] font-mono text-dim uppercase">Estágio</div>
                  <div className="mt-0.5 text-gold">{mem.lead_stage}</div>
                </div>
              )}
            </div>
            {(mem.interesses?.length ?? 0) > 0 && (
              <div className="text-sm"><span className="text-[10px] font-mono text-dim uppercase block mb-1">Interesses</span>
                <span className="text-dim">{mem.interesses.join(', ')}</span></div>
            )}
            {(mem.objections?.length ?? 0) > 0 && (
              <div className="text-sm"><span className="text-[10px] font-mono text-dim uppercase block mb-1">Objeções</span>
                <span className="text-dim">{mem.objections.join(', ')}</span></div>
            )}
            {mem.notas && (
              <div className="text-sm"><span className="text-[10px] font-mono text-dim uppercase block mb-1">Notas da IA</span>
                <span className="text-dim leading-relaxed">{mem.notas}</span></div>
            )}
            {mem.matricula_manual && (
              <div className="border border-win/30 bg-win/5 rounded-lg p-3 text-sm">
                <div className="text-[10px] font-mono text-win uppercase mb-1">🏆 Matrícula registrada manualmente</div>
                <div>{mem.matricula_manual.detalhes}</div>
                <div className="text-[10px] font-mono text-dim mt-1.5">
                  por {mem.matricula_manual.por} · {fmtHora(mem.matricula_manual.em)}</div>
              </div>
            )}

            <div className="border-t border-line pt-3">
              <div className="text-[10px] font-mono text-dim uppercase mb-1.5">📝 Notas do humano</div>
              <textarea rows={3} value={notas} onChange={e => setNotas(e.target.value)}
                placeholder="Observações da equipe sobre este lead…"
                className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60 placeholder:text-dim/40" />
              <button onClick={salvarNotas} disabled={salvando}
                className="mt-1.5 text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition disabled:opacity-40">
                Salvar notas
              </button>
            </div>

            <div className="border-t border-line pt-3">
              <div className="text-[10px] font-mono text-dim uppercase mb-1.5">🏆 Registrar matrícula manual</div>
              <textarea rows={2} value={matricula} onChange={e => setMatricula(e.target.value)}
                placeholder="Ex.: Combo Elite TJ-AM + Pós, fechado pelo humano em 21/07, 12x R$ 249…"
                className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-win/60 placeholder:text-dim/40" />
              <button onClick={salvarMatricula} disabled={salvando || !matricula.trim()}
                className="mt-1.5 text-xs font-semibold bg-win/15 text-win border border-win/40 rounded-lg px-3 py-1.5 hover:bg-win/25 transition disabled:opacity-40">
                Salvar e mover para Matriculados
              </button>
              <p className="text-[10px] text-dim/60 mt-1">Use para vendas fechadas fora da Anne (outra mentoria, combo, boleto na mão…). Fica gravado na memória do lead com autor e data.</p>
            </div>

            <div className="border-t border-line pt-3 flex items-center gap-2">
              <span className="text-[10px] font-mono text-dim uppercase">Mover para</span>
              <select className="flex-1 bg-panel2 border border-line rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                value={coluna(sel)} onChange={e => { mover(sel, e.target.value); setSel(null) }}>
                {COLS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
