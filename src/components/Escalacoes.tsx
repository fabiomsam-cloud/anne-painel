import { useEffect, useState } from 'react'
import { supabase, fmtHora, fmtFone } from '../lib/supabase'

type Esc = {
  id: string; reason: string | null; question_text: string | null; status: string
  claimed_by: string | null; created_at: string; resolved_at: string | null
  conversations: { id: string; status: string; contacts: { name: string | null; phone: string } }
}

type Vendedor = { id: string; nome: string; tipo: string; ativo: boolean }

export default function Escalacoes({ irParaInbox, isAdmin = false }:
  { irParaInbox: (convId?: string) => void; isAdmin?: boolean }) {
  const [escs, setEscs] = useState<Esc[]>([])
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false)
  // "Enviar para Comercial" (só admin): escolhe o vendedor → RPC fn_enviar_para_comercial (migration 33)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [enviando, setEnviando] = useState<Esc | null>(null)
  const [vendEscolhido, setVendEscolhido] = useState('')
  const [enviandoBusy, setEnviandoBusy] = useState(false)
  const [aviso, setAviso] = useState('')

  const carregar = async () => {
    const { data } = await supabase
      .from('escalations')
      .select('id,reason,question_text,status,claimed_by,created_at,resolved_at,conversations(id,status,contacts(name,phone))')
      .order('created_at', { ascending: false })
      .limit(100)
    setEscs((data as any) ?? [])
  }

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('vendedores').select('id,nome,tipo,ativo').eq('ativo', true).order('nome')
      .then(({ data }) => setVendedores((data as any) ?? []))
  }, [isAdmin])

  useEffect(() => {
    carregar()
    const ch = supabase.channel('escs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escalations' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Atender = assumir a escalação + conversa em modo humano + abrir a conversa no Inbox
  const claim = async (e: Esc) => {
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('escalations').update({
      status: 'claimed', claimed_by: u.user?.email ?? 'operador', claimed_at: new Date().toISOString(),
    }).eq('id', e.id)
    await supabase.from('conversations').update({ status: 'human' }).eq('id', e.conversations.id)
    irParaInbox(e.conversations.id)
  }

  const resolver = async (e: Esc, devolverIa: boolean) => {
    await supabase.from('escalations').update({
      status: 'resolved', resolved_at: new Date().toISOString(),
    }).eq('id', e.id)
    if (devolverIa) await supabase.from('conversations').update({ status: 'ia' }).eq('id', e.conversations.id)
  }

  // lead vira card ATIVO do vendedor (coluna Recebidos), conversa → humano_comercial,
  // vendedor vira responsável, escalação encerra com nota. Tudo atômico no banco.
  const enviarParaComercial = async () => {
    if (!enviando || !vendEscolhido || enviandoBusy) return
    setEnviandoBusy(true)
    const { data, error } = await supabase.rpc('fn_enviar_para_comercial', {
      p_escalation_id: enviando.id, p_vendedor_id: vendEscolhido,
    })
    setEnviandoBusy(false)
    const r = (data as any) ?? {}
    if (error || !r.ok) { setAviso('⚠️ ' + (error?.message || r.erro || 'Falha ao enviar.')); return }
    setAviso(`✅ ${enviando.conversations?.contacts?.name || fmtFone(enviando.conversations?.contacts?.phone)} enviado para ${r.vendedor} — já está em "Recebidos" na aba ☎️ Comercial.`)
    setEnviando(null); setVendEscolhido('')
    carregar()
  }

  const lista = escs.filter(e => mostrarResolvidas || e.status !== 'resolved')
  const minutosAberta = (e: Esc) => Math.round((Date.now() - new Date(e.created_at).getTime()) / 60000)

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl">Escalações</h1>
        <label className="text-xs text-dim flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={mostrarResolvidas} onChange={e => setMostrarResolvidas(e.target.checked)}
            className="accent-[#f5b942]" />
          mostrar resolvidas
        </label>
      </div>

      {aviso && (
        <div className="rise max-w-3xl mb-4 text-xs rounded-lg border border-line bg-panel px-3 py-2 flex items-center gap-3">
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso('')} className="text-dim hover:text-cream">✕</button>
        </div>
      )}

      <div className="space-y-3 max-w-3xl">
        {lista.map(e => (
          <div key={e.id} className={`rise border rounded-xl p-4
            ${e.status === 'open' ? 'border-danger/40 bg-danger/5' :
              e.status === 'claimed' ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel/50'}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">
                    {e.conversations?.contacts?.name || fmtFone(e.conversations?.contacts?.phone)}
                  </span>
                  <span className="font-mono text-[10px] text-dim">{fmtFone(e.conversations?.contacts?.phone)}</span>
                  {e.status === 'open' && (
                    <span className="text-[10px] font-mono text-danger">aberta há {minutosAberta(e)} min</span>
                  )}
                  {e.status === 'claimed' && (
                    <span className="text-[10px] font-mono text-gold">com {e.claimed_by}</span>
                  )}
                  {e.status === 'resolved' && (
                    <span className="text-[10px] font-mono text-win">resolvida {fmtHora(e.resolved_at)}</span>
                  )}
                </div>
                {e.question_text && (
                  <div className="text-sm mt-2 bg-panel2 border border-line rounded-lg px-3 py-2">"{e.question_text}"</div>
                )}
                {e.reason && <div className="text-xs text-dim mt-2 leading-relaxed">{e.reason}</div>}
                <div className="font-mono text-[10px] text-dim/60 mt-2">{fmtHora(e.created_at)}</div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {e.status === 'open' && (
                  <button onClick={() => claim(e)}
                    className="text-xs font-semibold bg-gold/15 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/25 transition">
                    Atender
                  </button>
                )}
                {e.status !== 'resolved' && (
                  <>
                    <button onClick={() => irParaInbox(e.conversations.id)}
                      className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">
                      Abrir no Inbox
                    </button>
                    <button onClick={() => resolver(e, true)}
                      className="text-xs font-semibold bg-teal/15 text-teal border border-teal/40 rounded-lg px-3 py-1.5 hover:bg-teal/25 transition">
                      Resolver + IA ↩
                    </button>
                    <button onClick={() => resolver(e, false)} title="Marca como resolvida e some desta tela; a conversa fica como está"
                      className="text-xs font-semibold bg-win/10 text-win border border-win/40 rounded-lg px-3 py-1.5 hover:bg-win/20 transition">
                      ✓ Encerrar
                    </button>
                    {isAdmin && (
                      <button onClick={() => { setEnviando(e); setVendEscolhido('') }}
                        title="Escolher um vendedor: o lead vira card dele no Comercial Humano (coluna Recebidos) e ele passa a ser o responsável"
                        className="text-xs font-semibold bg-gold/10 text-gold border border-gold/40 rounded-lg px-3 py-1.5 hover:bg-gold/20 transition">
                        ☎️ Enviar para Comercial
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {enviando && (
          <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => !enviandoBusy && setEnviando(null)}>
            <div className="rise w-full max-w-md bg-panel border border-line rounded-2xl p-5 space-y-4" onClick={ev => ev.stopPropagation()}>
              <div>
                <div className="font-display font-semibold text-lg">☎️ Enviar para Comercial</div>
                <div className="text-sm text-dim mt-1">
                  <b className="text-cream">{enviando.conversations?.contacts?.name || fmtFone(enviando.conversations?.contacts?.phone)}</b>
                  {' '}vira card do vendedor na coluna <b className="text-cream">Recebidos</b>, com posse de 14 dias.
                  O vendedor passa a ser o responsável e a escalação é encerrada.
                </div>
              </div>
              <label className="block">
                <span className="text-[10px] font-mono text-dim uppercase tracking-widest">Vendedor</span>
                <select value={vendEscolhido} onChange={ev => setVendEscolhido(ev.target.value)} autoFocus
                  className="mt-1 w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold/60">
                  <option value="">Escolha…</option>
                  {vendedores.map(v => (
                    <option key={v.id} value={v.id}>{v.nome}{v.tipo === 'escalacao' ? ' (escalação)' : ''}</option>
                  ))}
                </select>
                {vendedores.length === 0 && (
                  <div className="text-xs text-danger mt-1">Nenhum vendedor ativo — cadastre na aba ☎️ Comercial › Gestão.</div>
                )}
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEnviando(null)} disabled={enviandoBusy}
                  className="text-xs text-dim border border-line rounded-lg px-3 py-1.5 hover:text-cream transition">Cancelar</button>
                <button onClick={enviarParaComercial} disabled={!vendEscolhido || enviandoBusy}
                  className="text-xs font-semibold bg-gold text-ink rounded-lg px-4 py-1.5 hover:brightness-110 transition disabled:opacity-40">
                  {enviandoBusy ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
            </div>
          </div>
        )}
        {lista.length === 0 && (
          <div className="text-center py-16 text-dim">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-sm">Nenhuma escalação pendente — a Anne está dando conta.</div>
          </div>
        )}
      </div>
    </div>
  )
}
